const CHARSET='qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32M_CONST=0x2bc830a3;

function polymod(values){const generators=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];let checksum=1;for(const value of values){const top=checksum>>>25;checksum=((checksum&0x1ffffff)<<5)^value;for(let i=0;i<5;i++)if((top>>>i)&1)checksum^=generators[i]}return checksum>>>0}
function hrpExpand(hrp){return [...hrp].map(c=>c.charCodeAt(0)>>>5).concat([0],[...hrp].map(c=>c.charCodeAt(0)&31))}
function convertBits(data,fromBits,toBits,pad=true){let accumulator=0,bitCount=0;const result=[],mask=(1<<toBits)-1,maxAccumulator=(1<<(fromBits+toBits-1))-1;for(const value of data){if(value<0||(value>>>fromBits)!==0)throw new Error('bit conversion');accumulator=((accumulator<<fromBits)|value)&maxAccumulator;bitCount+=fromBits;while(bitCount>=toBits){bitCount-=toBits;result.push((accumulator>>>bitCount)&mask)}}if(pad){if(bitCount)result.push((accumulator<<(toBits-bitCount))&mask)}else if(bitCount>=fromBits||((accumulator<<(toBits-bitCount))&mask))throw new Error('padding');return result}

export function encodeAddress(payload,hrp='faet'){
  const data=convertBits(payload,8,5,true);
  const mod=(polymod([...hrpExpand(hrp),...data,0,0,0,0,0,0])^BECH32M_CONST)>>>0;
  const checksum=Array.from({length:6},(_,i)=>(mod>>>(5*(5-i)))&31);
  return hrp+'1'+[...data,...checksum].map(v=>CHARSET[v]).join('');
}

export function isValidAddress(address,hrp='faet'){
  try{
    if(typeof address!=='string'||address.length<8||address.length>90||address!==address.toLowerCase())return false;
    const separator=address.lastIndexOf('1'); if(address.slice(0,separator)!==hrp)return false;
    const values=[...address.slice(separator+1)].map(c=>CHARSET.indexOf(c));
    if(values.some(v=>v<0)||polymod([...hrpExpand(hrp),...values])!==BECH32M_CONST)return false;
    return convertBits(values.slice(0,-6),5,8,false).length===20;
  }catch{return false}
}
