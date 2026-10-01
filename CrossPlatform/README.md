# dnSpy Cross-Platform

This directory contains the Electron/React client and the UI-independent .NET backend used by the Linux build.

The existing WPF application remains in the repository while functionality is migrated behind the versioned RPC protocol.

## Prerequisites

- .NET SDK 10.0.112 or a compatible 10.0 patch
- Node.js 22 LTS
- pnpm 12.3.4

## Backend

```bash
dotnet build dnSpy.CrossPlatform.slnx
dotnet test dnSpy.CrossPlatform.slnx
```

## Desktop application

```bash
./scripts/install-netcoredbg.sh
pnpm install --frozen-lockfile
pnpm dev
```

Create AppImage and deb packages with:

```bash
pnpm package:linux
```

See [the Linux user guide](../docs/linux-user-guide.md) for supported workflows, installation and debugger permissions.
