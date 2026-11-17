// Lossless APNG from equal-sized Chromium PNG screenshots. No image toolkit or runtime dependency.
import {readFileSync,writeFileSync} from 'node:fs';
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function chunk(type:string,data:Buffer){
  const name=Buffer.from(type),body=Buffer.concat([name,data]);let crc=0xffffffff;
  for(const byte of body)crc=crcTable[(crc^byte)&255]!^(crc>>>8);
  const size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(data.length);sum.writeUInt32BE((crc^0xffffffff)>>>0);
  return Buffer.concat([size,body,sum]);
}
function png(path:string){
  const bytes=readFileSync(path);if(!bytes.subarray(0,8).equals(signature))throw new Error('Expected PNG');
  let header:Buffer|undefined;const data:Buffer[]=[];
  for(let at=8;at<bytes.length;){const length=bytes.readUInt32BE(at),type=bytes.toString('ascii',at+4,at+8),body=bytes.subarray(at+8,at+8+length);if(type==='IHDR')header=body;if(type==='IDAT')data.push(body);at+=length+12;}
  if(!header||!data.length||![2,6].includes(header[9]!))throw new Error('Expected truecolor PNG');
  return {header,data};
}
export function animate(frames:{path:string;milliseconds:number}[],target:string){
  if(!frames.length)throw new Error('No animation frames');
  const first=png(frames[0]!.path),control=Buffer.alloc(8);control.writeUInt32BE(frames.length);control.writeUInt32BE(0,4);
  const output=[signature,chunk('IHDR',first.header),chunk('acTL',control)];let sequence=0;
  frames.forEach((frame,i)=>{
    const current=png(frame.path);if(!current.header.equals(first.header))throw new Error('Animation frame formats differ');
    const info=Buffer.alloc(26);info.writeUInt32BE(sequence++);current.header.copy(info,4,0,8);info.writeUInt16BE(frame.milliseconds,20);info.writeUInt16BE(1000,22);
    output.push(chunk('fcTL',info));
    for(const data of current.data){if(!i)output.push(chunk('IDAT',data));else{const number=Buffer.alloc(4);number.writeUInt32BE(sequence++);output.push(chunk('fdAT',Buffer.concat([number,data])));}}
  });
  output.push(chunk('IEND',Buffer.alloc(0)));writeFileSync(target,Buffer.concat(output));
}
