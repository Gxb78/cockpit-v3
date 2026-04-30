#!/usr/bin/env python3
"""
Strict scan for dead CSS classes.
Only counts as "used" if the bare class name appears in:
  - class="..." or class='...' HTML attributes
  - className='...' or className="..." React-style
  - classList.add/remove/toggle/contains("...")
  - querySelector/querySelectorAll(".classname")
  - querySelector/querySelectorAll('#idname')
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

# Build strict usage patterns
# class="xxx" or class='xxx'
class_attr_pattern = re.compile(r'''class\s*=\s*"([^"]*)"|class\s*=\s*'([^']*)'|class\s*=\s*`([^`]*)`''')
classlist_pattern = re.compile(r'''classList\.(?:add|remove|toggle|contains)\s*\(\s*["'`]([^"'`]+)["'`]''')
query_sel_pattern = re.compile(r'''querySelector(?:All)?\s*\(\s*["'`]([.#][a-zA-Z0-9_-]+)["'`]''')
query_sel_pattern2 = re.compile(r'''querySelector(?:All)?\s*\(\s*["'`][.#]?([a-zA-Z0-9_-]+)["'`]''')
matches_pattern = re.compile(r'''\.matches\s*\(\s*["'`]([^"'`]+)["'`]''')
closest_pattern = re.compile(r'''\.closest\s*\(\s*["'`]([^"'`]+)["'`]''')

used_classes = set()

# Extract from class="..." attributes
for m in class_attr_pattern.finditer(all_text):
    val = m.group(1) or m.group(2) or m.group(3)
    for c in val.split():
        c = c.strip()
        if c:
            used_classes.add(c)

# Extract from classList methods
for m in classlist_pattern.finditer(all_text):
    val = m.group(1).strip()
    if val:
        used_classes.add(val)

# Extract from querySelector/querySelectorAll
for m in query_sel_pattern.finditer(all_text):
    val = m.group(1)
    bare = val.lstrip('.#')
    if bare:
        used_classes.add(bare)

for m in query_sel_pattern2.finditer(all_text):
    val = m.group(1).strip()
    if val and not val.startswith(('.', '#')):
        used_classes.add(val)

# Extract from matches/closest
for m in matches_pattern.finditer(all_text):
    val = m.group(1)
    classes = re.findall(r'\.([a-zA-Z0-9_-]+)', val)
    for c in classes:
        used_classes.add(c)

for m in closest_pattern.finditer(all_text):
    val = m.group(1)
    classes = re.findall(r'\.([a-zA-Z0-9_-]+)', val)
    for c in classes:
        used_classes.add(c)

# Also check hx-class / hx-target / hx-trigger attributes
hx_class_pattern = re.compile(r'''hx-class\s*=\s*"([^"]*)"|hx-class\s*=\s*'([^']*)'|hx-target\s*=\s*"([^"]*)"|hx-target\s*=\s*'([^']*)'|hx-indicator\s*=\s*"([^"]*)"|hx-indicator\s*=\s*'([^']*)'|data-hx-class\s*=\s*"([^"]*)"|data-hx-class\s*=\s*'([^']*)''')
for m in hx_class_pattern.finditer(all_text):
    for g in m.groups():
        if g:
            for c in g.split():
                c = c.strip().lstrip('.')
                if c:
                    used_classes.add(c)

# HTMX hx-swap with classes
hx_swap_pattern = re.compile(r'''hx-swap\s*=\s*"([^"]*)"|hx-swap\s*=\s*'([^']*)'|hx-get\s*=\s*"([^"]*)"|hx-get\s*=\s*'([^']*)'|hx-post\s*=\s*"([^"]*)"|hx-post\s*=\s*'([^']*)''')
# (just for reference, these don't usually contain class names)

# Alpine.js x-bind:class
alpine_pattern = re.compile(r'''x-bind:class\s*=\s*"([^"]*)"|:class\s*=\s*"([^"]*)"''')
for m in alpine_pattern.finditer(all_text):
    val = m.group(1) or m.group(2)
    if val:
        # Alpine uses objects like {'classname': condition}
        for c in re.findall(r"'([a-zA-Z0-9_-]+)'", val):
            used_classes.add(c)
        for c in re.findall(r'"([a-zA-Z0-9_-]+)"', val):
            used_classes.add(c)

# Also check for `addClass` / `removeClass` jQuery-style
jq_pattern = re.compile(r'''\.(?:addClass|removeClass|toggleClass|hasClass)\s*\(\s*["'`]([^"'`]+)["'`]''')
for m in jq_pattern.finditer(all_text):
    val = m.group(1)
    for c in val.split():
        c = c.strip()
        if c:
            used_classes.add(c)

# Extract IDs from HTML id="..." attributes
used_ids = set()
id_pattern = re.compile(r'''id\s*=\s*"([^"]*)"|id\s*=\s*'([^']*)'|for\s*=\s*"([^"]*)"|for\s*=\s*'([^']*)'|href\s*=\s*"#([^"]*)"|href\s*=\s*'#([^']*)''')
for m in id_pattern.finditer(all_text):
    for g in m.groups():
        if g:
            used_ids.add(g)

# Also querySelector('#id') etc
for m in query_sel_pattern.finditer(all_text):
    val = m.group(1)
    if val.startswith('#'):
        used_ids.add(val[1:])

print(f"Unique classes used in HTML/JS: {len(used_classes)}", file=sys.stderr)
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

# Now scan each CSS file
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
            
            # Split by comma
            individual_selectors = [s.strip() for s in re.split(r',(?=(?:[^"]*"[^"]*")*[^"]*$)', full_sel)]
            
            for ind_sel in individual_selectors:
                # Extract classes
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
                    
                    key = f"{filename}:{lineno}"
                    if cls not in all_results:
                        all_results[cls] = {'locations': [], 'used': used}
                    all_results[cls]['locations'].append(key)
                    if used:
                        all_results[cls]['used'] = True
                
                # Extract IDs
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

print(f"\n=== Dead CSS Selectors ({len(dead)} found) ===")
for cls, info in dead:
    for loc in info['locations']:
        print(f"{loc} — {cls}")

print(f"\nTotal CSS selectors extracted: {len(all_results)}", file=sys.stderr)
print(f"Dead selectors: {len(dead)}", file=sys.stderr)
