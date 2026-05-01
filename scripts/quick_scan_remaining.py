#!/usr/bin/env python3
"""Quick scan for remaining CSS files 034-052."""
import os, re, sys

PROJECT = "/mnt/c/Users/gb781/Desktop/Journal"
CSS_DIR = os.path.join(PROJECT, "static/css/split")

remaining = [f"034_priority3_stats_settings_insights.css", "035_priority4_overlays_menus.css",
             "036_plan_po3_flow.css", "037_spotlight_today.css", "038_kpi_upgrade.css",
             "039_pretext_greeting.css", "040_trade_cockpit_cards.css", "041_day_modal_cockpit.css",
             "042_unified_date_picker.css", "043_dashboard_pnl_motion_fix.css",
             "044_interactive_empty_background.css", "045_today_context_widget.css",
             "046_journal_day_trade_cards.css", "047_trade_form_light_cards.css",
             "048_card_surface.css", "049_metric_pill.css", "050_trade_hero_card.css",
             "051_focus_transitions.css", "052_stats_pattern_explorer.css"]

all_files = []
for root, dirs, fnames in os.walk(os.path.join(PROJECT, "templates")):
    for f in fnames:
        if f.endswith('.html'): all_files.append(os.path.join(root, f))
for root, dirs, fnames in os.walk(os.path.join(PROJECT, "static/js/split")):
    for f in fnames:
        if f.endswith('.js'): all_files.append(os.path.join(root, f))

print(f"Searching in {len(all_files)} HTML/JS files\n")

GENERIC = {"box","grid","bar","tab","card","row","col","item","header","footer","body",
           "title","text","icon","left","right","top","bottom","center","middle",
           "sm","md","lg","xl","xs","active","hover","focus","disabled","selected",
           "hidden","visible","show","hide","container","wrapper","inner","outer",
           "group","section","block","list","link","btn","button","input","label",
           "value","step","slide","page","panel","overlay","backdrop","dialog","popup",
           "tooltip","dropdown","menu","submenu","badge","pill","chip","tag",
           "metric","kpi","stat","chart","legend","axis","tick","gridline",
           "slot","zone","area","region","primary","secondary","success","warning",
           "danger","error","info","light","dark","small","large","mini","full",
           "half","open","close","min","max","first","last","prev","next",
           "start","end","before","after","data",
           "note","label","value","key","name","desc","actions"}

for css_file in sorted(remaining):
    path = os.path.join(CSS_DIR, css_file)
    if not os.path.exists(path):
        print(f"  SKIP {css_file} (not found)")
        continue
    
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        content = f.read()
    
    text = re.sub(r'/\*.*?\*/', '', content, flags=re.DOTALL)
    
    # Extract unique class, ID, and attribute names
    classes = set(re.findall(r'\.([a-zA-Z0-9_-]+)', text))
    ids = set(re.findall(r'#([a-zA-Z0-9_-]+)', text))
    attrs = set(re.findall(r'\[([a-zA-Z_-]+)', text))
    
    all_selectors = set()
    for c in classes: all_selectors.add(c)
    for i in ids: all_selectors.add(i)
    for a in attrs: all_selectors.add(a)
    
    if not all_selectors:
        continue
    
    # Search each selector across all files
    found = set()
    combined = '\n'.join(open(f, 'r', encoding='utf-8', errors='replace').read() for f in all_files)
    
    for sel in all_selectors:
        if re.search(rf'\b{re.escape(sel)}\b', combined):
            found.add(sel)
    
    missing = all_selectors - found
    meaningful = {s for s in missing if s not in GENERIC and not s.startswith('data')}
    
    total_meaningful = {s for s in all_selectors if s not in GENERIC and not s.startswith('data')}
    
    if meaningful:
        pct = len(meaningful) / len(total_meaningful) * 100 if total_meaningful else 0
        
        if pct >= 80:
            status = "🔴 SUSPECT"
        elif pct >= 50:
            status = "🟡 PARTIAL"
        elif pct >= 30:
            status = "🔵 WARN"
        else:
            status = "⚪ MINOR"
        
        print(f"  {status} {css_file}")
        print(f"       {len(meaningful)}/{len(total_meaningful)} orphaned ({pct:.0f}%)")
        print(f"       Missing: {', '.join(sorted(meaningful))}")
        print()
    else:
        print(f"  ✅ {css_file} — all selectors found")
