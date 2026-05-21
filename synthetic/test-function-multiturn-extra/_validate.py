#!/usr/bin/env python3
"""Validator for multiturn-extra conversation files."""
import json, sys, re, os

FORBIDDEN = [r'\btuan\b', r'\bbro\b', r'\bboss\b', r'\bmachi\b', r'\bmachan\b', r'\bpadu\b', r'\bsyiok\b', r'wah lao', r'tak siao', r'kan ni nei']

def validate(path, lib_path):
    errs = []
    with open(path) as f:
        data = json.load(f)
    lib = json.load(open(lib_path))
    lib_fns = {f['name'] for f in lib['functions']}
    msgs = data['messages']
    user_turns = sum(1 for m in msgs if m['role'] == 'user')
    if not (10 <= user_turns <= 20):
        errs.append(f"user turns {user_turns} not in [10,20]")
    tool_call_ids = {}
    fn_used = set()
    for i, m in enumerate(msgs):
        if m['role'] == 'assistant':
            for tc in m.get('tool_calls', []) or []:
                tool_call_ids[tc['id']] = tc['function']['name']
                fn_used.add(tc['function']['name'])
                try:
                    json.loads(tc['function']['arguments'])
                except Exception as e:
                    errs.append(f"msg {i} tool_call {tc['id']} arguments not JSON: {e}")
                if tc['function']['name'] not in lib_fns:
                    errs.append(f"msg {i} fn {tc['function']['name']} not in library")
        elif m['role'] == 'tool':
            tcid = m.get('tool_call_id')
            if tcid not in tool_call_ids:
                errs.append(f"msg {i} tool_call_id {tcid} has no prior assistant call")
            try:
                json.loads(m['content'])
            except Exception as e:
                errs.append(f"msg {i} tool content not JSON: {e}")
    if len(fn_used) < 8:
        errs.append(f"only {len(fn_used)} distinct functions used: {fn_used}")
    full_text = json.dumps(msgs).lower()
    for pat in FORBIDDEN:
        if re.search(pat, full_text):
            errs.append(f"forbidden pattern found: {pat}")
    has_voc = False
    for m in msgs:
        if m['role'] == 'assistant':
            txt = m.get('content') or ''
            if re.search(r'\b(Encik|Puan|Sir|Madam)\b', txt):
                has_voc = True; break
    if not has_voc:
        errs.append("no Encik/Puan/Sir/Madam in assistant content")
    meta = data.get('metadata', {})
    if len(meta.get('api_errors_simulated', [])) < 3:
        errs.append("less than 3 api errors in metadata")
    if len(meta.get('out_of_context_turns', [])) < 2:
        errs.append("less than 2 out_of_context_turns")
    if len(meta.get('agent_edges_demonstrated', [])) < 2:
        errs.append("less than 2 agent edges")
    lp = meta.get('language_profile', '')
    user_text = ' '.join(m.get('content','') for m in msgs if m['role']=='user')
    if lp == 'tamil':
        tam_toks = ['Vanakkam', 'Nandri', 'Romba', 'Aiyo', 'Aiyoyo', 'Aiyaa', 'appadi', 'seri']
        found = sum(1 for t in tam_toks if t.lower() in user_text.lower())
        if found < 3:
            errs.append(f"tamil profile but only {found} tamil tokens")
    if lp == 'mandarin':
        man_toks = ['Ni hao', 'Zao', 'Wan an', 'Xie xie', 'Hao de', 'Dui', 'Bu hao', 'bu xing', 'Ai yaa']
        found = sum(1 for t in man_toks if t.lower() in user_text.lower())
        if found < 2:
            errs.append(f"mandarin profile but only {found} mandarin tokens")
    return errs, user_turns, len(fn_used)

if __name__ == '__main__':
    path = sys.argv[1]
    idx = int(re.search(r'(\d+)\.json', path).group(1))
    lib = f'/home/husein/ssd3/SyntheticGen/synthetic/test-function/{idx}.json'
    errs, ut, fc = validate(path, lib)
    if errs:
        print('FAIL', path)
        for e in errs: print(' -', e)
        sys.exit(1)
    print('OK', path, f'turns={ut} fns={fc}')
