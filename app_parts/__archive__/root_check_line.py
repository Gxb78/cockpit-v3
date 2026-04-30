from _js_source import load_js_source


content = load_js_source()
hits = []
for idx, line in enumerate(content.splitlines(), start=1):
    chars = [hex(ord(c)) for c in line if ord(c) > 127]
    if chars:
        hits.append((idx, chars, line))

print(f"Lines with non-ASCII chars: {len(hits)}")
for idx, chars, line in hits[:20]:
    print(f"Line {idx}: {chars} :: {ascii(line)}")
