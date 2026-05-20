"""Print required-fields summary for a given library + list of fn names."""
import json
import sys
from pathlib import Path

idx = int(sys.argv[1])
names = sys.argv[2:] if len(sys.argv) > 2 else None

with open(f'/home/husein/ssd3/SyntheticGen/synthetic/test-function/{idx}.json') as f:
    lib = json.load(f)

for fn in lib['functions']:
    if names and fn['name'] not in names:
        continue
    print('=' * 60)
    print(fn['name'])
    p = fn.get('parameters', {})
    print('REQUIRED:', p.get('required'))
    for r in p.get('required', []):
        sub = p['properties'].get(r, {})
        print(f'  -- {r}:', json.dumps(sub, ensure_ascii=False)[:800])
