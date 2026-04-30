BS = chr(92)

from _js_source import load_js_source


content = load_js_source()

# Find all backtick positions with surrounding context
# Track which ones are in comments or strings to identify "free" backticks
state = 'normal'
free_backticks = []
i = 0
line = 1

while i < len(content):
    c = content[i]
    if c == '\n':
        line += 1
    nc = content[i+1] if i+1 < len(content) else ''

    if state == 'normal':
        if c == '/' and nc == '/':
            state = 'slc'
            i += 2
            continue
        elif c == '/' and nc == '*':
            state = 'blc'
            i += 2
            continue
        elif c == '"':
            state = 'dq'
        elif c == "'":
            state = 'sq'
        elif c == '`':
            free_backticks.append((i, line))
    elif state == 'slc':
        if c == '\n':
            state = 'normal'
    elif state == 'blc':
        if c == '*' and nc == '/':
            state = 'normal'
            i += 2
            continue
    elif state == 'dq':
        if c == BS:
            i += 2
            continue
        elif c == '"':
            state = 'normal'
    elif state == 'sq':
        if c == BS:
            i += 2
            continue
        elif c == "'":
            state = 'normal'
    # Note: we DON'T track template state separately here
    # so backticks inside /* */ are not counted as free
    i += 1

print(f"Free backticks (outside // and /* */ comments and \"' strings): {len(free_backticks)}")
print(f"Balanced: {len(free_backticks) % 2 == 0}")

# Find the odd one out - pair them up
# Template backticks should pair as: open, close, open, close...
# But inside template expressions ${...}, there can be nested strings with backticks
# For now, just show the last few to find the unmatched one
if len(free_backticks) % 2 != 0:
    print("\nLast 5 free backtick positions:")
    for pos, ln in free_backticks[-5:]:
        ctx = content[max(0,pos-30):pos+30]
        print(f"  line {ln}: {repr(ctx)}")

    # Find the last "lonely" backtick
    # If pairs are (0,1), (2,3), (4,5)... and total is odd, last one is unmatched
    last = free_backticks[-1]
    print(f"\nLast free backtick at line {last[1]}:")
    print(repr(content[max(0,last[0]-50):last[0]+50]))
