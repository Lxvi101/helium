#!/usr/bin/env python3
"""Apply the native sidebar patch and its predecessors to exact Chromium sources.

Downloads only files touched by arc-sidebar.patch. This is patch applicability
validation, not a substitute for compiling and running Chromium.
"""
import concurrent.futures
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'devutils' / 'third_party'))
import unidiff # pylint: disable=wrong-import-position


def main():
    """Fetch matching upstream files and apply the relevant patch hunks in order."""
    patch_name = 'helium/ui/layout/arc-sidebar.patch'
    sidebar = unidiff.PatchSet((ROOT / 'patches' / patch_name).read_text())
    paths = {item.path for item in sidebar}
    version = (ROOT / 'chromium_version.txt').read_text().strip()
    patches = []
    created = set()
    for line in (ROOT / 'patches' / 'series').read_text().splitlines():
        if not line.strip() or line.startswith('#'):
            continue
        selected = [
            item for item in unidiff.PatchSet((ROOT / 'patches' / line).read_text())
            if item.path in paths
        ]
        created.update(item.path for item in selected if item.is_added_file)
        if selected:
            patches.append((line, ''.join(str(item) for item in selected)))
    with tempfile.TemporaryDirectory(prefix='helium-arc-validation-') as directory:
        source_root = Path(directory)

        def fetch(path):
            destination = source_root / path
            destination.parent.mkdir(parents=True, exist_ok=True)
            url = f'https://raw.githubusercontent.com/chromium/chromium/{version}/{path}'
            with urllib.request.urlopen(url, timeout=60) as response:
                destination.write_bytes(response.read())

        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
            list(executor.map(fetch, sorted(paths - created)))
        for name, contents in patches:
            result = subprocess.run(['patch', '-p1', '--batch', '--fuzz=0'],
                                    input=contents,
                                    text=True,
                                    cwd=source_root,
                                    capture_output=True,
                                    check=False)
            if result.returncode:
                raise RuntimeError(f'{name}\n{result.stdout}\n{result.stderr}')
        print(f'Applied {len(patches)} patches to {len(paths)} files from Chromium {version}.')
        print('Native compilation and runtime verification are still required.')


if __name__ == '__main__':
    main()
