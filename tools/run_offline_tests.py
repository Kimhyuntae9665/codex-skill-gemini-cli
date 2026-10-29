"""Run original Node tests under an isolated dummy profile; no actual CLI or login."""
from pathlib import Path
import os,subprocess,tempfile,json
R=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='gemini-skill-offline-') as temp:
 p=Path(temp);local=p/'local';cli=local/'agy/bin/agy.exe';cli.parent.mkdir(parents=True);cli.write_bytes(b'')
 settings=p/'.gemini/antigravity-cli/settings.json';settings.parent.mkdir(parents=True);settings.write_text(json.dumps({'useG1Credits':False}),'utf8')
 env=dict(os.environ,USERPROFILE=str(p),LOCALAPPDATA=str(local),HOME=str(p))
 for key in ('GEMINI_API_KEY','GOOGLE_API_KEY','GOOGLE_APPLICATION_CREDENTIALS','AGY_ADC_AUTH'):env.pop(key,None)
 result=subprocess.run(['node','--test','scripts/tests/test-antigravity-bridge.mjs','scripts/tests/test-fallback.mjs'],cwd=R,env=env)
 raise SystemExit(result.returncode)
