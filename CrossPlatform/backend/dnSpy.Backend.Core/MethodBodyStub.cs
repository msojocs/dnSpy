using System;
using System.Collections.Generic;
using System.Linq;
using dnlib.DotNet;
using dnlib.DotNet.Emit;
using dnSpy.Backend.Contracts;

namespace dnSpy.Backend.Core;

/// <summary>
/// Builds the body dnSpy's Edit &gt; "Replace Method Body with stub..." installs: the smallest body that
/// still satisfies the method's signature — a base-constructor call for a reference type's constructor,
/// default values for <c>out</c> parameters and for the return type — so the rewritten method decompiles
/// back into valid C#. A bare <c>ret</c> would not do: it leaves a value-returning method without a
/// value and a derived constructor without a chained base call.
/// </summary>
/// <remarks>
/// Ported from dnSpy.AsmEditor's <c>DefaultCilBodyBuilder</c> (GPL-3.0), minus the parts that only exist
/// to drive the IL editor UI (header RVAs, PDB method, exception handlers).
/// </remarks>
static class MethodBodyStub {
	public static CilBody Create(MethodDef method) {
		var body = new CilBody();
		// KeepOldMaxStack stays false with MaxStack 0, so dnlib recomputes the stack depth when the
		// module is written rather than trusting a value that belongs to the body this one replaces.

		if (method.IsInstanceConstructor) {
			if (!method.DeclaringType.IsValueType) {
				var baseConstructor = GetBaseConstructorForEmptyBody(method);
				if (baseConstructor is not null) {
					body.Instructions.Add(Instruction.Create(OpCodes.Ldarg_0));
					foreach (var parameter in ResolveBaseParameters(method.DeclaringType.BaseType, baseConstructor.MethodSig))
						PushDefaultValue(body, parameter, false);
					body.Instructions.Add(Instruction.Create(OpCodes.Call, baseConstructor));
				}
			}
			else if (!method.DeclaringType.IsEnum) {
				foreach (var field in method.DeclaringType.Fields) {
					if (field.IsStatic || field.IsLiteral)
						continue;
					var addressOnStack = AcceptsAddressOnStack(field.FieldType);
					body.Instructions.Add(Instruction.Create(OpCodes.Ldarg_0));
					if (addressOnStack)
						body.Instructions.Add(Instruction.Create(OpCodes.Ldflda, field));
					PushDefaultValue(body, field.FieldType, addressOnStack);
					if (!addressOnStack)
						body.Instructions.Add(Instruction.Create(OpCodes.Stfld, field));
				}
			}
		}

		// Assign defaults to `out` parameters too, so the decompiled stub still produces valid C#.
		foreach (var parameter in method.Parameters) {
			if (!parameter.HasParamDef || !parameter.ParamDef.IsOut)
				continue;
			var unwrapped = UnwrapFirstByRef(parameter.Type);
			body.Instructions.Add(GetLdarg(parameter));
			PushDefaultValue(body, unwrapped, true);
			if (!AcceptsAddressOnStack(unwrapped))
				body.Instructions.Add(CreateAddressStore(unwrapped));
		}

		PushDefaultValue(body, method.ReturnType, false);
		body.Instructions.Add(Instruction.Create(OpCodes.Ret));
		return body;
	}

	static TypeSig UnwrapFirstByRef(TypeSig type) {
		type = type.RemovePinnedAndModifiers();
		return type is ByRefSig byRef ? byRef.Next : type;
	}

	static bool AcceptsAddressOnStack(TypeSig type) {
		while (true) {
			switch (type.ElementType) {
			case ElementType.GenericInst:
				var genericInstance = (GenericInstSig)type;
				if (genericInstance.GenericType.RemovePinnedAndModifiers() is ClassSig)
					return false;
				goto case ElementType.ValueType;

			case ElementType.ValueType:
				var resolved = ResolveTypeDef(((ValueTypeSig)type).TypeDefOrRef);
				if (resolved is { IsEnum: true }) {
					type = GetEnumUnderlyingType(resolved);
					continue;
				}
				goto case ElementType.Var;

			case ElementType.Var:
			case ElementType.TypedByRef:
			case ElementType.I:
			case ElementType.U:
			case ElementType.MVar:
				return true;

			case ElementType.CModOpt:
			case ElementType.CModReqd:
				type = type.Next;
				continue;

			default:
				return false;
			}
		}
	}

	static void PushDefaultValue(CilBody body, TypeSig type, bool addressOnStack, bool pushAsRef = false) {
		switch (type.ElementType) {
		case ElementType.Void:
			return;

		case ElementType.Boolean:
		case ElementType.Char:
		case ElementType.I1:
		case ElementType.U1:
		case ElementType.I2:
		case ElementType.U2:
		case ElementType.I4:
		case ElementType.U4:
			body.Instructions.Add(Instruction.Create(OpCodes.Ldc_I4_0));
			break;

		case ElementType.I8:
		case ElementType.U8:
			body.Instructions.Add(Instruction.Create(OpCodes.Ldc_I8, 0L));
			break;

		case ElementType.R4:
			body.Instructions.Add(Instruction.Create(OpCodes.Ldc_R4, 0F));
			break;

		case ElementType.R8:
			body.Instructions.Add(Instruction.Create(OpCodes.Ldc_R8, 0D));
			break;

		case ElementType.String:
		case ElementType.Class:
		case ElementType.Array:
		case ElementType.Object:
		case ElementType.SZArray:
			body.Instructions.Add(Instruction.Create(OpCodes.Ldnull));
			break;

		case ElementType.Ptr:
		case ElementType.FnPtr:
			body.Instructions.Add(Instruction.Create(OpCodes.Ldc_I4_0));
			body.Instructions.Add(Instruction.Create(OpCodes.Conv_U));
			break;

		case ElementType.ValueType:
			var resolved = ResolveTypeDef(((ValueTypeSig)type).TypeDefOrRef);
			if (resolved is { IsEnum: true })
				PushDefaultValue(body, GetEnumUnderlyingType(resolved), addressOnStack, pushAsRef);
			else
				goto case ElementType.Var;
			break;

		case ElementType.Var:
		case ElementType.TypedByRef:
		case ElementType.I:
		case ElementType.U:
		case ElementType.MVar:
			if (addressOnStack && !pushAsRef) {
				// The address is already on the stack; zero-initialize through it.
				body.Instructions.Add(Instruction.Create(OpCodes.Initobj, type.ToTypeDefOrRef()));
				return;
			}
			var local = new Local(type);
			body.Variables.Add(local);
			body.Instructions.Add(Instruction.Create(OpCodes.Ldloca, local));
			body.Instructions.Add(Instruction.Create(OpCodes.Initobj, type.ToTypeDefOrRef()));
			body.Instructions.Add(Instruction.Create(pushAsRef ? OpCodes.Ldloca : OpCodes.Ldloc, local));
			break;

		case ElementType.GenericInst:
			var genericInstance = (GenericInstSig)type;
			if (genericInstance.GenericType.RemovePinnedAndModifiers() is ClassSig)
				goto case ElementType.Class;
			goto case ElementType.ValueType;

		case ElementType.ByRef:
			PushDefaultValue(body, type.Next, addressOnStack, true);
			return;

		case ElementType.CModOpt:
		case ElementType.CModReqd:
			PushDefaultValue(body, type.Next, addressOnStack, pushAsRef);
			return;

		default:
			throw new RpcException(ErrorCodes.EditValidationFailed, $"Cannot build a stub for a return value of type {type}.");
		}

		if (pushAsRef) {
			var local = new Local(type);
			body.Variables.Add(local);
			body.Instructions.Add(Instruction.Create(OpCodes.Stloc, local));
			body.Instructions.Add(Instruction.Create(OpCodes.Ldloca, local));
		}
	}

	static Instruction GetLdarg(Parameter parameter) => parameter.Index switch {
		0 => Instruction.Create(OpCodes.Ldarg_0),
		1 => Instruction.Create(OpCodes.Ldarg_1),
		2 => Instruction.Create(OpCodes.Ldarg_2),
		3 => Instruction.Create(OpCodes.Ldarg_3),
		_ => parameter.Index <= byte.MaxValue
			? Instruction.Create(OpCodes.Ldarg_S, parameter)
			: Instruction.Create(OpCodes.Ldarg, parameter),
	};

	static Instruction CreateAddressStore(TypeSig signature) {
		switch (signature.RemovePinnedAndModifiers().ElementType) {
		case ElementType.Boolean:
		case ElementType.I1:
		case ElementType.U1:
			return Instruction.Create(OpCodes.Stind_I1);
		case ElementType.Char:
		case ElementType.I2:
		case ElementType.U2:
			return Instruction.Create(OpCodes.Stind_I2);
		case ElementType.I4:
		case ElementType.U4:
			return Instruction.Create(OpCodes.Stind_I4);
		case ElementType.I8:
		case ElementType.U8:
			return Instruction.Create(OpCodes.Stind_I8);
		case ElementType.R4:
			return Instruction.Create(OpCodes.Stind_R4);
		case ElementType.R8:
			return Instruction.Create(OpCodes.Stind_R8);
		case ElementType.String:
		case ElementType.Class:
		case ElementType.Array:
		case ElementType.Object:
		case ElementType.SZArray:
			return Instruction.Create(OpCodes.Stind_Ref);
		case ElementType.I:
		case ElementType.U:
			return Instruction.Create(OpCodes.Stind_I);
		case ElementType.GenericInst:
			var genericInstance = (GenericInstSig)signature.RemovePinnedAndModifiers();
			if (genericInstance.GenericType.RemovePinnedAndModifiers() is ClassSig)
				return Instruction.Create(OpCodes.Stind_Ref);
			return Instruction.Create(OpCodes.Stobj, signature.ToTypeDefOrRef());
		case ElementType.Ptr:
		case ElementType.ByRef:
		case ElementType.ValueType:
		case ElementType.Var:
		case ElementType.TypedByRef:
		case ElementType.FnPtr:
		case ElementType.MVar:
			return Instruction.Create(OpCodes.Stobj, signature.ToTypeDefOrRef());
		default:
			throw new RpcException(ErrorCodes.EditValidationFailed, $"Cannot store a default value of type {signature}.");
		}
	}

	static MethodDef? GetBaseConstructorForEmptyBody(MethodDef method) {
		var baseType = ResolveTypeDef(method.DeclaringType.BaseType);
		if (baseType is null)
			return null;
		var candidates = baseType.Methods.Where(candidate => candidate.IsInstanceConstructor).ToList();
		if (candidates.Count == 0)
			return null;
		var sameAssembly = IsSameAssembly(baseType, method.DeclaringType);
		candidates.Sort((left, right) => {
			var order = GetAccessForEmptyBody(left, sameAssembly) - GetAccessForEmptyBody(right, sameAssembly);
			if (order != 0)
				return order;
			// A constructor without ref/out parameters is easier to satisfy: its arguments are defaults too.
			order = HasByRefParameter(left) - HasByRefParameter(right);
			return order != 0 ? order : left.Parameters.Count - right.Parameters.Count;
		});
		return candidates[0];
	}

	static int HasByRefParameter(MethodDef method) =>
		method.MethodSig?.Params.Any(parameter => parameter.RemovePinnedAndModifiers() is ByRefSig) == true ? 1 : 0;

	static int GetAccessForEmptyBody(MethodDef method, bool sameAssembly) => method.Access switch {
		MethodAttributes.Public or MethodAttributes.FamORAssem or MethodAttributes.Family => 0,
		MethodAttributes.Assembly or MethodAttributes.FamANDAssem => sameAssembly ? 0 : 1,
		MethodAttributes.Private => 2,
		_ => 3,
	};

	/// <summary>
	/// The parameter types the base constructor call has to satisfy. For a base type that is a generic
	/// instantiation they are substituted first, so <c>base(int)</c> on <c>SomeBase&lt;int&gt;</c> pushes
	/// a default <c>int</c> and not a default <c>T</c> — which in the derived method's own generic
	/// context, where that <c>T</c> does not exist, would be a body the runtime cannot resolve.
	/// </summary>
	static IList<TypeSig> ResolveBaseParameters(ITypeDefOrRef? baseType, MethodBaseSig? signature) {
		if (signature is null)
			return Array.Empty<TypeSig>();
		if (baseType is not TypeSpec spec)
			return signature.Params;
		var genericInstance = spec.TypeSig.ToGenericInstSig();
		if (genericInstance is null)
			return signature.Params;
		var arguments = genericInstance.GenericArguments;
		return signature.Params.Select(parameter => SubstituteTypeArguments(parameter, arguments)).ToArray();
	}

	/// <summary>
	/// Replaces the base type's generic parameters with the arguments it was instantiated with, leaving
	/// method generic parameters alone — a base constructor is never a generic method.
	/// </summary>
	static TypeSig SubstituteTypeArguments(TypeSig type, IList<TypeSig> arguments) {
		switch (type.ElementType) {
		case ElementType.Var:
			var variable = (GenericVar)type;
			return variable.Number < (uint)arguments.Count ? arguments[(int)variable.Number] : type;

		case ElementType.GenericInst:
			var instance = (GenericInstSig)type;
			return new GenericInstSig(instance.GenericType, instance.GenericArguments.Select(argument => SubstituteTypeArguments(argument, arguments)).ToList());

		case ElementType.SZArray:
			return new SZArraySig(SubstituteTypeArguments(type.Next, arguments));

		case ElementType.Array:
			var array = (ArraySig)type;
			return new ArraySig(SubstituteTypeArguments(array.Next, arguments), array.Rank);

		case ElementType.ByRef:
			return new ByRefSig(SubstituteTypeArguments(type.Next, arguments));

		case ElementType.Ptr:
			return new PtrSig(SubstituteTypeArguments(type.Next, arguments));

		case ElementType.CModOpt:
			return new CModOptSig(((CModOptSig)type).Modifier, SubstituteTypeArguments(type.Next, arguments));

		case ElementType.CModReqd:
			return new CModReqdSig(((CModReqdSig)type).Modifier, SubstituteTypeArguments(type.Next, arguments));

		default:
			return type;
		}
	}

	static bool IsSameAssembly(TypeDef left, TypeDef right) =>
		left.Module.Assembly is { } leftAssembly && right.Module.Assembly is { } rightAssembly &&
		(ReferenceEquals(leftAssembly, rightAssembly) || leftAssembly.FullName == rightAssembly.FullName);

	static TypeDef? ResolveTypeDef(ITypeDefOrRef? type) => type switch {
		TypeDef typeDef => typeDef,
		TypeRef typeRef => typeRef.Resolve(),
		TypeSpec typeSpec => ResolveTypeDef(typeSpec.ScopeType),
		_ => null,
	};

	static TypeSig GetEnumUnderlyingType(TypeDef type) {
		foreach (var field in type.Fields) {
			if (!field.IsStatic)
				return field.FieldType;
		}
		return type.Module.CorLibTypes.Int32;
	}
}
