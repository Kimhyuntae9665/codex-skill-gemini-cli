"""Offline package integrity, UTF-8, syntax, and local-document link checks."""
from pathlib import Path
from urllib.parse import unquote,urlsplit
import ast,hashlib,json,re,sys
R=Path(__file__).resolve().parents[1]
M=json.loads((R/'package-manifest.json').read_text('utf8'))
errors=[]
for name,want in M['files'].items():
 p=R/name
 if not p.is_file():errors.append('missing: '+name);continue
 if hashlib.sha256(p.read_bytes()).hexdigest()!=want:errors.append('hash mismatch: '+name)
if hashlib.sha256((R/'SKILL.md').read_bytes()).hexdigest()!=M['original_skill_sha256']:errors.append('SKILL.md differs from published original')
skill=(R/'SKILL.md').read_text('utf-8-sig')
if not skill.startswith('---') or not re.search(r'^name:\s*'+re.escape(M['skill_name'])+r'\s*$',skill,re.M):errors.append('invalid original skill identity')
external=[]
for name in M['files']:
 p=R/name
 if p.suffix=='.py':
  try:ast.parse(p.read_text('utf-8-sig'),filename=name)
  except (SyntaxError,UnicodeError) as exc:errors.append('Python syntax: '+name+': '+str(exc))
 if p.suffix.lower()!='.md':continue
 for match in re.finditer(r'!?\[[^\]]*\]\(([^)]+)\)',p.read_text('utf-8-sig')):
  raw=match.group(1).strip().strip('<>')
  if not raw or raw.startswith('#') or urlsplit(raw).scheme or raw.startswith('//'):continue
  target=unquote(raw.split('#',1)[0])
  if not (p.parent/target).exists():errors.append('broken relative link: '+name+' -> '+target)
print(json.dumps(dict(pass_=not errors,skill=M['skill_name'],original_skill_sha256=M['original_skill_sha256'],verified_files=len(M['files']),errors=errors),ensure_ascii=False,indent=2))
raise SystemExit(bool(errors))
