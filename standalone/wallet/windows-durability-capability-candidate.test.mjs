// V56 empirical Windows namespace durability probe. NO Wallet or funds touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,open,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectNodeDirectorySync,inspectIsolatedWin32Durability} from
  './windows-durability-capability-candidate.mjs';

test('V56 Windows original-outbox directory-fsync alternative feasibility, never power-loss attestation',
  {timeout:80000},async()=>{
  const parent=await realpath(tmpdir());
  const dir=await mkdtemp(join(parent,'ts-v56-durability-only-'));
  const source=join(dir,'isolated-move-source.bin');
  const dest=join(dir,'isolated-move-target.bin');
  try{
    const owner=await open(source,'wx',0o600);
    try{await owner.writeFile(Buffer.alloc(32,0x56));await owner.sync()}
    finally{await owner.close()}
    const nodeSync=await inspectNodeDirectorySync(dir);
    assert.equal(nodeSync.original_outbox_durable,false);
    assert.equal(nodeSync.power_loss_verified,false);
    if(process.platform==='win32'){
      assert.equal(nodeSync.node_directory_sync,'FAILED',
        'unexpected Windows Node directory fsync behavior must be reviewed');
      const native=await inspectIsolatedWin32Durability({directory:dir,
        source,destination:dest});
      assert.equal(native.schema,'ts.v56.windows-durability-observation.v1');
      assert.equal(native.authorize_signed_tx,false);
      assert.equal(native.original_outbox_durable,false);
      assert.equal(native.power_loss_verified,false);
      if(native.move_write_through_returned){
        assert.deepEqual(await readFile(dest),Buffer.alloc(32,0x56));
      }
      await assert.rejects(
        inspectIsolatedWin32Durability({directory:dir,
          source:join(dir,'wrong-source.bin'),destination:dest}),
        /Unsafe isolated|ENOENT|Redirected|Noncanonical/);
      console.log('TS_V56_WIN32_DURABILITY_CAPABILITY_NO_ADMISSION '+JSON.stringify({
        node_directory_sync:nodeSync.node_directory_sync,
        node_errno:nodeSync.reason,
        native_directory_opened:native.directory_opened,
        native_directory_open_error:native.directory_open_error,
        native_directory_flush_returned:native.directory_flush_returned,
        native_directory_flush_error:native.directory_flush_error,
        move_write_through_returned:native.move_write_through_returned,
        move_write_through_error:native.move_write_through_error,
        power_loss_verified:false,original_outbox_durable:false,
        authorized_native_signed_send:false
      }));
    }else{
      assert.equal(nodeSync.node_directory_sync,'RETURNED_SUCCESS');
      await assert.rejects(inspectIsolatedWin32Durability({directory:dir,
        source,destination:dest}),/Windows-only candidate/);
      console.log('TS_V56_UNIX_DIRECTORY_SYNC_ONLY_NOT_WIN32_ADMISSION '+JSON.stringify({
        os:process.platform,node_directory_sync:nodeSync.node_directory_sync,
        original_outbox_durable:false,power_loss_verified:false
      }));
    }
  }finally{await rm(dir,{recursive:true,force:true})}
});
