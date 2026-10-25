/** Synthetic tone only; never a real person's voice. */
export function syntheticPcm(samples=16000){const pcm=Buffer.alloc(samples*2);for(let i=0;i<samples;i++)pcm.writeInt16LE(Math.round(Math.sin(i/16000*2*Math.PI*440)*2000),i*2);
  const h=Buffer.alloc(44);h.write('RIFF');h.writeUInt32LE(pcm.length+36,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(16000,24);h.writeUInt32LE(32000,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(pcm.length,40);return Buffer.concat([h,pcm]);}
