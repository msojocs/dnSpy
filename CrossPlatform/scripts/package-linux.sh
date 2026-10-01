#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
root_dir="$(cd -- "${script_dir}/.." && pwd)"

cd "${root_dir}"
"${script_dir}/install-netcoredbg.sh"
node "${script_dir}/generate-linux-icon.mjs"
pnpm --dir frontend build

rm -rf -- artifacts/publish
dotnet publish backend/dnSpy.Backend.Host/dnSpy.Backend.Host.csproj \
	--configuration Release \
	--runtime linux-x64 \
	--self-contained true \
	-p:PublishSingleFile=false \
	-p:UseSharedCompilation=false \
	--output artifacts/publish/backend/linux-x64

node "${script_dir}/generate-sbom.mjs"

mkdir -p artifacts/publish/debugger/linux-x64
cp -a .tools/netcoredbg/. artifacts/publish/debugger/linux-x64/
pnpm --dir frontend exec electron-builder --config ../packaging/electron-builder.yml --linux AppImage deb
