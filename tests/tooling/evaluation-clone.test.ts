import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,readFile,symlink,link,lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { cloneEvaluationProfile,databaseFingerprint,sameEvaluationFile } from '../../scripts/evaluation/clone.ts';
if(!process.env.DAFEIYU_TEST_RUN||!tmpdir().startsWith(process.env.DAFEIYU_TEST_RUN))throw new Error('MANAGED_TEST_RUN_REQUIRED');

test('large Windows file identities do not round distinct files into a hard link, while true aliases remain detectable',async()=>{
  const a={dev:2225967174n,ino:18577348463537542n},b={dev:2225967174n,ino:18577348463537546n};
  assert.equal(Number(a.ino),Number(b.ino));assert.equal(sameEvaluationFile(a,b),false);assert.equal(sameEvaluationFile(a,{...a}),true);
  assert.equal(sameEvaluationFile(a,{...a,dev:a.dev+1n}),false);
  const root=await mkdtemp(join(tmpdir(),'eval-identity-')),original=join(root,'original'),alias=join(root,'alias'),independent=join(root,'copy');
  await writeFile(original,'fixture');await link(original,alias);await writeFile(independent,'fixture');
  const exact=await lstat(original,{bigint:true});assert.equal(sameEvaluationFile(exact,await lstat(alias,{bigint:true})),true);
  assert.equal(sameEvaluationFile(exact,await lstat(independent,{bigint:true})),false);
});
test('paired profile clones use SQLite backups and independent ordinary files without changing the baseline',async()=>{const root=await mkdtemp(join(tmpdir(),'eval-clone-')),source=join(root,'baseline');await mkdir(source);await writeFile(join(source,'session.jsonl'),'fictional\n');const db=new DatabaseSync(join(source,'data.sqlite'));db.exec("CREATE TABLE facts(id INTEGER PRIMARY KEY,text TEXT);INSERT INTO facts VALUES(1,'source');PRAGMA user_version=4;");db.close();const before=databaseFingerprint(join(source,'data.sqlite')),a=await cloneEvaluationProfile(root,source,join(root,'full')),b=await cloneEvaluationProfile(root,source,join(root,'compressed'));assert.equal(a.logicalHash,b.logicalHash);const changed=new DatabaseSync(join(root,'full/data.sqlite'));changed.exec("UPDATE facts SET text='changed'");changed.close();await writeFile(join(root,'full/session.jsonl'),'changed');assert.equal(databaseFingerprint(join(source,'data.sqlite')),before);assert.equal(await readFile(join(root,'compressed/session.jsonl'),'utf8'),'fictional\n');await assert.rejects(cloneEvaluationProfile(root,source,join(root,'full')),/PATH_DENIED/);});
test('clone refuses linked files, outside destinations and active ownership rows',async()=>{const root=await mkdtemp(join(tmpdir(),'eval-clone-deny-')),source=join(root,'baseline');await mkdir(source);await assert.rejects(cloneEvaluationProfile(root,source,join(root,'../outside')),/PATH_DENIED/);const db=new DatabaseSync(join(source,'data.sqlite'));db.exec('CREATE TABLE ownership(pid INTEGER);INSERT INTO ownership VALUES(1);');db.close();await assert.rejects(cloneEvaluationProfile(root,source,join(root,'owned')),/BASELINE_OWNED/);const other=join(root,'other');await mkdir(other);await symlink(other,join(source,'alias'),'junction');await assert.rejects(cloneEvaluationProfile(root,source,join(root,'linked')),/LINK_DENIED/);});
