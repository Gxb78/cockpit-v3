#!/usr/bin/env python3
"""
Debug: Show sample CSS selectors and verify detection.
"""
import os, re, sys

BASE = "/mnt/c/Users/gb781/Desktop/Journal"
CSS_DIR = os.path.join(BASE, "static/css/split")
HTML_DIR = os.path.join(BASE, "templates")
JS_DIR = os.path.join(BASE, "static/js/split")

css_files = sorted([
    os.path.join(CSS_DIR, f) for f in sorted(os.listdir(CSS_DIR))
    if f.endswith(".css")
])

# Gather search corpus
all_search_text = ""
for root, dirs, files in os.walk(HTML_DIR):
    for f in files:
        if f.endswith(".html"):
            fp = os.path.join(root, f)
            with open(fp, "r", encoding="utf-8") as fh:
                all_search_text += fh.read() + "\n"
for f in sorted(os.listdir(JS_DIR)):
    if f.endswith(".js"):
        fp = os.path.join(JS_DIR, f)
        with open(fp, "r", encoding="utf-8") as fh:
            all_search_text += fh.read() + "\n"
main_js = os.path.join(BASE, "static/app.js")
if os.path.exists(main_js):
    with open(main_js, "r", encoding="utf-8") as fh:
        all_search_text += fh.read() + "\n"
main_css = os.path.join(BASE, "static/style.css")
if os.path.exists(main_css):
    with open(main_css, "r", encoding="utf-8") as fh:
        all_search_text += fh.read() + "\n"

# Extract all CSS selectors (debug)
for css_path in css_files[:5]:  # First 5 files
    filename = os.path.basename(css_path)
    print(f"\n=== {filename} ===")
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
                    # Skip pseudo and exclude
                    pseudo_suffixes = [':hover', ':focus', ':active', ':visited', ':focus-visible',
                        ':focus-within', ':first-child', ':last-child', ':nth-child',
                        ':nth-of-type', ':first-of-type', ':last-of-type',
                        ':before', ':after', ':not', ':is', ':where', ':has',
                        ':disabled', ':enabled', ':checked', ':required', ':optional',
                        ':read-only', ':read-write', ':empty', ':target',
                        '::before', '::after', '::first-line', '::first-letter',
                        '::selection', '::placeholder', '::marker', '::backdrop',
                        '::slotted', '::part', '::file-selector-button']
                    if any(p in cls for p in pseudo_suffixes):
                        continue
                    if cls in {'.hidden', '.active', '.mono', '.disabled', '.visible', '.selected',
                               '.block-body', '.block-row'}:
                        continue
                    
                    bare = cls.lstrip('.')
                    # Check if used
                    found_patterns = []
                    patterns_to_check = [
                        f'class="{bare}',
                        f"class='{bare}",
                        f'classList.add("{bare}',
                        f'classList.remove("{bare}',
                        f'.{bare}"',
                        f".{bare}'",
                        f'.{bare} ',
                    ]
                    for p in patterns_to_check:
                        if p in all_search_text:
                            found_patterns.append(p[:40])
                    
                    # Also word boundary
                    word_found = bool(re.search(r'(?<![a-zA-Z0-9_-])' + re.escape(bare) + r'(?![a-zA-Z0-9_-])', all_search_text))
                    
                    status = "USED" if found_patterns or word_found else "DEAD"
                    extra = ""
                    if found_patterns:
                        extra = f"  [{found_patterns[0]}]"
                    elif word_found:
                        extra = "  [word match]"
                    print(f"  {cls} -> {status}{extra}")
        elif '}' in clean:
            selector_accum = ""
        elif not clean.startswith('@') and clean:
            selector_accum = clean
        else:
            selector_accum = ""
