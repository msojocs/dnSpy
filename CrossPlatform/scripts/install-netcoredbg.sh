#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
root_dir="$(cd -- "${script_dir}/.." && pwd)"
version="3.2.0-1092"
archive="${root_dir}/.tools/downloads/netcoredbg-linux-amd64-${version}.tar.gz"
destination="${root_dir}/.tools/netcoredbg"
url="https://github.com/Samsung/netcoredbg/releases/download/${version}/netcoredbg-linux-amd64.tar.gz"
expected_sha256="080eb3b2d2152465f599d3b33d1ee6e747794e11cc0a3773ec689f5e5f2c5afa"

mkdir -p "$(dirname -- "${archive}")"
if [[ ! -f "${archive}" ]]; then
	curl --fail --location --retry 3 --output "${archive}" "${url}"
fi

actual_sha256="$(sha256sum "${archive}" | cut -d ' ' -f 1)"
if [[ "${actual_sha256}" != "${expected_sha256}" ]]; then
	echo "netcoredbg checksum mismatch: expected ${expected_sha256}, got ${actual_sha256}" >&2
	exit 1
fi

rm -rf -- "${destination}"
mkdir -p "${destination}"
tar -xzf "${archive}" -C "${destination}" --strip-components=1
test -x "${destination}/netcoredbg"
"${destination}/netcoredbg" --version
