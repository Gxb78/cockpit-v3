from _js_source import load_js_source


content = load_js_source()

depth = 0
in_string = False
string_char = None
i = 0
line = 1
while i < len(content):
    c = content[i]
    if c == '\n':
        line += 1
    if in_string:
        backslash = '\\'
        if c == backslash and string_char != '`':
            i += 2
            continue
        if c == string_char:
            in_string = False
    else:
        if c in ('"', "'", '`'):
            in_string = True
            string_char = c
        elif c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth < 0:
                print(f"Unmatched close brace at line {line}")
                break
    i += 1

print(f"Final brace depth: {depth}")
print(f"Total lines: {line}")
