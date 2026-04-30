from _js_source import load_js_source


content = load_js_source()
depth = 0
line = 1
i = 0
in_string = False
string_char = None

while i < len(content):
    c = content[i]
    if c == "\n":
        line += 1
    if in_string:
        if c == "\\" and string_char != "`":
            i += 2
            continue
        if c == string_char:
            in_string = False
            string_char = None
    else:
        if c in ('"', "'", "`"):
            in_string = True
            string_char = c
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
    i += 1

print(f"Brace depth: {depth} (target 0)")
print(f"Lines: {line}")
print("No obvious balance errors" if depth == 0 and not in_string else "Potential balance issue detected")
