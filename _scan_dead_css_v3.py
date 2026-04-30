#!/usr/bin/env python3
"""
Strict scan for dead CSS classes - v3 with string concatenation detection.
"""
import os, re, sys

BASE = "/mnt/c/Users/gb781/Desktop/Journal"
CSS_DIR = os.path.join(BASE, "static/css/split")
HTML_DIR = os.path.join(BASE, "templates")
JS_DIR = os.path.join(BASE, "static/js/split")

# Gather all CSS files
css_files = sorted([os.path.join(CSS_DIR, f) for f in sorted(os.listdir(CSS_DIR)) if f.endswith(".css")])

# Gather ALL content
all_text = ""
folders = [HTML_DIR, JS_DIR, os.path.join(BASE, "static/js"), os.path.join(BASE, "static/css")]
files_to_check = [
    os.path.join(BASE, "static/app.js"),
    os.path.join(BASE, "static/style.css"),
]
for folder in folders:
    if os.path.isdir(folder):
        for root, dirs, files in os.walk(folder):
            for f in files:
                if f.endswith(('.html', '.js', '.css')):
                    fp = os.path.join(root, f)
                    with open(fp, "r", encoding="utf-8") as fh:
                        all_text += fh.read() + "\n"
for fp in files_to_check:
    if os.path.exists(fp):
        with open(fp, "r", encoding="utf-8") as fh:
            all_text += fh.read() + "\n"

print(f"Total search text: {len(all_text)} chars", file=sys.stderr)

used_classes = set()

# 1. Extract from class="..." attributes
for m in re.finditer(r'''class\s*=\s*"([^"]*)"|class\s*=\s*'([^']*)'|class\s*=\s*`([^`]*)`''', all_text):
    val = m.group(1) or m.group(2) or m.group(3)
    for c in val.split():
        c = c.strip()
        if c:
            used_classes.add(c)

# 2. classList methods
for m in re.finditer(r'''classList\.(?:add|remove|toggle|contains)\s*\(\s*["'`]([^"'`]+)["'`]''', all_text):
    val = m.group(1).strip()
    if val:
        used_classes.add(val)

# 3. querySelector/All with explicit selector strings
for m in re.finditer(r'''querySelector(?:All)?\s*\(\s*["'`]([.#][a-zA-Z0-9_-]+)["'`]''', all_text):
    val = m.group(1)
    bare = val.lstrip('.#')
    if bare:
        used_classes.add(bare)

# 4. matches/closest
for m in re.finditer(r'''\.matches\s*\(\s*["'`]([^"'`]+)["'`]''', all_text):
    for c in re.findall(r'\.([a-zA-Z0-9_-]+)', m.group(1)):
        used_classes.add(c)
for m in re.finditer(r'''\.closest\s*\(\s*["'`]([^"'`]+)["'`]''', all_text):
    for c in re.findall(r'\.([a-zA-Z0-9_-]+)', m.group(1)):
        used_classes.add(c)

# 5. htmx attributes
for m in re.finditer(r'''hx-class\s*=\s*"([^"]*)"|hx-class\s*=\s*'([^']*)'|hx-indicator\s*=\s*"([^"]*)"|hx-indicator\s*=\s*'([^']*)'|data-hx-class\s*=\s*"([^"]*)"|data-hx-class\s*=\s*'([^']*)''', all_text):
    for g in m.groups():
        if g:
            for c in g.split():
                c = c.strip().lstrip('.')
                if c:
                    used_classes.add(c)

# 6. Alpine.js x-bind:class / :class
for m in re.finditer(r'''x-bind:class\s*=\s*"([^"]*)"|:class\s*=\s*"([^"]*)"''', all_text):
    val = m.group(1) or m.group(2)
    if val:
        for c in re.findall(r"'([a-zA-Z0-9_-]+)'", val):
            used_classes.add(c)
        for c in re.findall(r'"([a-zA-Z0-9_-]+)"', val):
            used_classes.add(c)

# 7. jQuery-like addClass/removeClass/toggleClass
for m in re.finditer(r'''\.(?:addClass|removeClass|toggleClass|hasClass)\s*\(\s*["'`]([^"'`]+)["'`]''', all_text):
    val = m.group(1)
    for c in val.split():
        c = c.strip()
        if c:
            used_classes.add(c)

# 8. KEY NEW: String concatenation in className assignments
# Pattern: className = "..." + (cond ? " classname" : "") + ...
# Pattern: " base " + variable + " classname"
# Pattern: `.foo-${var}` template literals
# We need to find all string literals that contain class names

# Find all JS string literals that might be concatenated for className
# className = "..." patterns
for m in re.finditer(r'''className\s*=\s*["'`]([^"'`]*)["'`]''', all_text):
    val = m.group(1)
    # The value might be partial, but classes are space-separated
    for c in val.split():
        c = c.strip()
        if c:
            used_classes.add(c)

# Also handle: className = "foo" + cond ? " bar" : ""
# Extract all quoted strings that appear in expressions with className
# Pattern: " classname" or "classname " within string concatenation
# We look for quoted strings containing spaces and class-like tokens
lines = all_text.split('\n')
for line in lines:
    if 'className' in line or 'classList' in line or 'class' in line:
        # Find all double-quoted and single-quoted strings in this line
        for m in re.finditer(r'''["'`]([a-zA-Z0-9_\-\s]+)["'`]''', line):
            val = m.group(1)
            # If the string looks like it contains CSS classes (space-separated tokens)
            if ' ' in val:
                tokens = val.split()
                for t in tokens:
                    t = t.strip()
                    if t and not t.startswith('${'):
                        used_classes.add(t)
            # Single tokens are also potential class names
            elif val and len(val) > 1:
                # Only if there's a dot or class-related keyword nearby
                pass

# Also check for template literals with embedded vars for class names
# Like: `day-mode-${mode}` — the prefix "day-mode-" is a class prefix
for m in re.finditer(r'`([^`]*\$\{[^}]*\}[^`]*)`', all_text):
    val = m.group(1)
    # Extract the static prefixes/suffixes
    parts = re.split(r'\$\{[^}]+\}', val)
    for p in parts:
        p = p.strip().strip('-').strip()
        if p and len(p) > 2:
            # This might be a class name prefix or suffix
            # Add it so we don't report it as dead
            # e.g., `day-mode-${mode}` → "day-mode-" prefix
            used_classes.add(p)

# Also: look for `" " + var + " classname"` pattern in className assignments
# Check each JS line for className string concatenation
for m in re.finditer(r'className\s*\+?=\s*["\'`]([^"\'`]*)["\'`]', all_text):
    # This catches: className += " classname" or className = "classname"
    val = m.group(1)
    for c in val.split():
        c = c.strip()
        if c:
            used_classes.add(c)

# Also check: document.getElementById('x').className = "..."
for m in re.finditer(r'\.className\s*=\s*["\'`]([^"\'`]*)["\'`]', all_text):
    val = m.group(1)
    for c in val.split():
        c = c.strip()
        if c:
            used_classes.add(c)

# Check for backtick template literals with embedded classes
# `${ ... }` patterns
for m in re.finditer(r'classList\s*\.\s*add\s*\(\s*`([^`]*)`', all_text):
    val = m.group(1)
    # Parse template literals - remove ${...} parts
    bare = re.sub(r'\$\{[^}]+\}', '', val)
    for c in bare.split():
        c = c.strip().strip('-')
        if c:
            used_classes.add(c)

print(f"Unique classes used in HTML/JS: {len(used_classes)}", file=sys.stderr)

# Extract IDs from HTML
used_ids = set()
id_pattern = re.compile(r'''id\s*=\s*"([^"]*)"|id\s*=\s*'([^']*)'|for\s*=\s*"([^"]*)"|for\s*=\s*'([^']*)'|href\s*=\s*"#([^"]*)"|href\s*=\s*'#([^']*)''')
for m in id_pattern.finditer(all_text):
    for g in m.groups():
        if g:
            used_ids.add(g)
for m in re.finditer(r'''querySelector(?:All)?\s*\(\s*["'`](#[a-zA-Z0-9_-]+)["'`]''', all_text):
    val = m.group(1)
    if val.startswith('#'):
        used_ids.add(val[1:])

print(f"Unique IDs used in HTML/JS: {len(used_ids)}", file=sys.stderr)

# Exclude list
EXCLUDE_CLASSES = {
    '.hidden', '.active', '.mono', '.disabled', '.visible', '.selected',
    '.loading', '.error', '.success', '.warning', '.info', '.empty',
    '.focus', '.hover', '.checked', '.expanded', '.collapsed',
    '.open', '.closed', '.done', '.pending', '.inactive',
    '.block-body', '.block-row',
}

PSEUDO_SUFFIXES = [
    ':hover', ':focus', ':active', ':visited', ':focus-visible',
    ':focus-within', ':first-child', ':last-child', ':nth-child',
    ':nth-of-type', ':first-of-type', ':last-of-type',
    ':before', ':after', ':not', ':is', ':where', ':has',
    ':disabled', ':enabled', ':checked', ':required', ':optional',
    ':read-only', ':read-write', ':empty', ':target',
    ':link', ':any-link', ':only-child', ':only-of-type',
    ':scope', ':root', ':defined', ':host', ':host-context',
    ':lang', ':dir', ':placeholder-shown', ':default',
    ':in-range', ':out-of-range', ':valid', ':invalid',
    ':user-valid', ':user-invalid', ':indeterminate',
    '::before', '::after', '::first-line', '::first-letter',
    '::selection', '::placeholder', '::marker', '::backdrop',
    '::slotted', '::part', '::file-selector-button',
]

def has_pseudo(cls):
    return any(p in cls for p in PSEUDO_SUFFIXES)

# Scan each CSS file
all_results = {}

for css_path in css_files:
    filename = os.path.basename(css_path)
    with open(css_path, "r", encoding="utf-8") as f:
        lines = f.readlines()
    
    selector_accum = ""
    
    for lineno, line in enumerate(lines, 1):
        stripped = line.strip()
        if not stripped or stripped.startswith('/*') or stripped.startswith('*'):
            continue
        clean = re.sub(r'/\*.*?\*/', '', stripped)
        
        if '{' in clean:
            sel_part = clean.split('{')[0].strip()
            full_sel = sel_part
            if selector_accum:
                full_sel = (selector_accum + ' ' + sel_part).strip()
            selector_accum = ""
            
            individual_selectors = [s.strip() for s in re.split(r',(?=(?:[^"]*"[^"]*")*[^"]*$)', full_sel)]
            
            for ind_sel in individual_selectors:
                classes = re.findall(r'\.[a-zA-Z0-9_-]+', ind_sel)
                for cls in classes:
                    if has_pseudo(cls):
                        continue
                    if cls in EXCLUDE_CLASSES:
                        continue
                    if cls.startswith('.--') or '--' in cls[1:]:
                        continue
                    
                    bare = cls.lstrip('.')
                    used = bare in used_classes
                    
                    # Also check for the class in the whole text as substring in class context
                    if not used:
                        # Check if the bare name appears in any class-related context
                        patterns = [
                            f'class="{bare}',
                            f"class='{bare}",
                            f'.{bare}"',
                            f".{bare}'",
                            f'classList.add("{bare}',
                            f'classList.add(`{bare}',
                            f'className+"{bare}',
                            f'+ "{bare}',
                            f'+ \'{bare}',
                            f'+ `{bare}',
                            f'addClass("{bare}',
                            f' `{bare}',
                            f'"{bare} ',
                        ]
                        for p in patterns:
                            if p in all_text:
                                used = True
                                break
                    
                    key = f"{filename}:{lineno}"
                    if cls not in all_results:
                        all_results[cls] = {'locations': [], 'used': used}
                    all_results[cls]['locations'].append(key)
                    if used:
                        all_results[cls]['used'] = True
                
                ids = re.findall(r'\#[a-zA-Z0-9_-]+', ind_sel)
                for id_ in ids:
                    rid = id_.split(':')[0].split('::')[0]
                    if rid != id_:
                        continue
                    
                    bare = rid.lstrip('#')
                    used = bare in used_ids
                    
                    key = f"{filename}:{lineno}"
                    if rid not in all_results:
                        all_results[rid] = {'locations': [], 'used': used}
                    all_results[rid]['locations'].append(key)
                    if used:
                        all_results[rid]['used'] = True
        
        elif '}' in clean:
            selector_accum = ""
        elif not clean.startswith('@') and clean:
            selector_accum = clean
        else:
            selector_accum = ""

# Output dead selectors
dead = [(cls, info) for cls, info in sorted(all_results.items()) if not info['used']]

for cls, info in dead:
    for loc in info['locations']:
        print(f"{loc} — {cls}")

print(f"\nTotal CSS selectors extracted: {len(all_results)}", file=sys.stderr)
print(f"Dead selectors: {len(dead)}", file=sys.stderr)
