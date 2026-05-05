import re

path = 'static/js/split/055_indicator_vwap_core.js'
with open(path, 'r', encoding='utf-8', newline='') as f:
    content = f.read()

# 1. Replace normalizeCandlesForLwc
old_func_start = content.find('  function normalizeCandlesForLwc(raw) {')
old_func_end = content.find('\n  // ', old_func_start + 50)  # next comment section
old_norm = content[old_func_start:old_func_end]

new_norm = '''  function normalizeCandlesForLwc(raw) {
    var byTime = {};

    (raw || []).forEach(function (c) {
      if (!c) return;

      var rawTime = c.time != null ? c.time : (c.openTime != null ? c.openTime : c.t);
      var time = _normalizeTimeToSeconds(rawTime);

      var open = _numRequired(c.open);
      var high = _numRequired(c.high);
      var low = _numRequired(c.low);
      var close = _numRequired(c.close);
      var volume = _numOptional(c.volume, 0);

      if (!Number.isFinite(time) || time <= 0) return;
      if (!Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) return;

      if (high < low) return;
      if (high < Math.max(open, close)) return;
      if (low > Math.min(open, close)) return;

      byTime[time] = {
        time: time,
        open: open,
        high: high,
        low: low,
        close: close,
        volume: volume,
      };
    });

    return Object.keys(byTime)
      .map(function (t) { return byTime[t]; })
      .sort(function (a, b) { return a.time - b.time; });
  }'''

content = content.replace(old_norm, new_norm)

if content.find('byTime[time]') == -1:
    print('REPLACE FAILED - byTime not found')
    exit(1)

# 2. Add _numRequired and _numOptional before _normalizeTimeToSeconds
insert_pos = content.find('  function _normalizeTimeToSeconds(t) {')
helpers = '''  function _numRequired(v) {
    if (v === null || v === undefined || v === '') return NaN;
    var n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }

  function _numOptional(v, fallback) {
    if (v === null || v === undefined || v === '') return fallback;
    var n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

'''
content = content[:insert_pos] + helpers + content[insert_pos:]

# 3. Add sanitizeLineData after normalizeCandlesForLwc
sani_pos = content.find('  //', content.find('byTime[time]') + 50)
sanitize = '''
  function sanitizeLineData(points) {
    var byTime = {};

    (points || []).forEach(function (p) {
      if (!p) return;

      var time = Number(p.time);
      var value = Number(p.value);

      if (!Number.isFinite(time) || time <= 0) return;
      if (!Number.isFinite(value)) return;

      byTime[time] = { time: time, value: value };
    });

    return Object.keys(byTime)
      .map(function (t) { return byTime[t]; })
      .sort(function (a, b) { return a.time - b.time; });
  }

'''
content = content[:sani_pos] + sanitize + content[sani_pos:]

# 4. In drawVwapForChart, add sanitizeLineData before setData
old_setdata = 's.setData(aligned);'
new_setdata = '''    aligned = sanitizeLineData(aligned);
    if (aligned.length < 2) return;
    s.setData(aligned);'''
content = content.replace(old_setdata, new_setdata)

with open(path, 'w', encoding='utf-8', newline='') as f:
    f.write(content)

print('OK - all patches applied')
