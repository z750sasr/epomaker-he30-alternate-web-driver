"""Generate the Pages artifact with per-commit asset URLs and reload checks."""
import argparse
import json
import re
import subprocess
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parents[1]
TAG = re.compile(r'<(?:script|link)\b[^>]*>', re.I)
ATTRIBUTE = re.compile(r'\b(src|href)=("|\')([^"\']+)\2', re.I)
IMPORT = re.compile(r"(\b(?:from\s+|import\s+|import\(\s*))(['\"])(\.{1,2}/[^'\"\n]+)\2")
CSS_IMPORT = re.compile(r'(@import\s+(?:url\(\s*)?)(["\'])([^"\']+)(\2)')


def version_url(url, revision, suffixes):
    parts = urlsplit(url)
    if parts.scheme or parts.netloc or Path(parts.path).suffix not in suffixes:
        return url
    query = '&'.join(filter(None, [parts.query, f'rev={revision}']))
    return urlunsplit(parts._replace(query=query))


def write_html(source, name, revision):
    def asset(match):
        name, quote, url = match.groups()
        return f'{name}={quote}{version_url(url, revision, {".js", ".mjs", ".css"})}{quote}'

    html = TAG.sub(lambda match: ATTRIBUTE.sub(asset, match[0]), source)
    # Resolve this from the HTML path so project Pages and local subpaths work.
    base = '../' * (len(name.parts) - 1)
    watch = f'<script defer src="{base}driver-revision.js?rev={revision}"></script>'
    return re.sub(r'</head\s*>', lambda m: watch + m[0], html, count=1, flags=re.I)


def build(output, revision):
    paths = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')
    output.mkdir(parents=True, exist_ok=True)
    for text in filter(None, paths):
        name = Path(text)
        if name.parts[0].startswith('.') or not (ROOT / name).is_file():
            continue
        data = (ROOT / name).read_bytes()
        suffix = name.suffix.lower()
        if suffix in {'.html', '.mjs', '.js', '.css'}:
            source = data.decode('utf-8')
            if suffix == '.html':
                source = write_html(source, name, revision)
            elif suffix == '.css':
                source = CSS_IMPORT.sub(lambda m: m[1] + m[2] + version_url(m[3], revision, {'.css'}) + m[4], source)
            else:
                source = IMPORT.sub(lambda m: m[1] + m[2] + version_url(m[3], revision, {'.js', '.mjs'}) + m[2], source)
            data = source.encode('utf-8')
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    (output / '.nojekyll').touch()
    (output / 'driver-version.json').write_text(json.dumps({'revision': revision}), encoding='utf-8')
    (output / 'driver-revision.js').write_bytes((ROOT / 'scripts/driver-revision.js').read_bytes())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r'[0-9a-f]{7,40}', args.revision):
        parser.error('Expected the Git commit SHA.')
    build(args.output, args.revision)
