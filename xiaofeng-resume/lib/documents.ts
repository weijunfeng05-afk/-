import {extractText,getDocumentProxy} from 'unpdf';
import mammoth from 'mammoth';
import {AppError} from './db';
export function checkFile(file:File){if(!/\.(pdf|docx)$/i.test(file.name))throw new AppError('仅支持 PDF 或 DOCX 文件');if(!file.size||file.size>10*1024*1024)throw new AppError('文件不能为空且不能超过 10 MB');}
export async function parseDocument(bytes:ArrayBuffer,filename:string){
 const data=new Uint8Array(bytes);let text='';
 try{
  if(/\.pdf$/i.test(filename)){if(new TextDecoder().decode(data.slice(0,5))!=='%PDF-')throw Error('格式不匹配');const doc=await getDocumentProxy(data);try{if(doc.numPages>50)throw new AppError('文件超过 50 页，请拆分后上传');const result=await extractText(doc,{mergePages:true});text=result.text;}finally{await doc.loadingTask.destroy();}}
  else {checkZip(data);if(data[0]!==0x50||data[1]!==0x4b)throw Error('格式不匹配');text=(await mammoth.extractRawText({buffer:Buffer.from(data)})).value;}
 }catch(e){if(e instanceof AppError)throw e;throw new AppError('文件解析失败，请确认文件未加密、未损坏，且为 PDF 或 DOCX 格式');}
 text=text.replace(/\u0000/g,'').trim();if(text.length<30)throw new AppError('未提取到足够文字，扫描件请先 OCR 后重新上传');if(text.length>60000)throw new AppError('文件文字超过 60,000 字符，请精简后重新上传');return text;
}



function checkZip(data:Uint8Array){const view=new DataView(data.buffer,data.byteOffset,data.byteLength);let total=0,entries=0;for(let i=0;i+46<=data.length;i++){if(view.getUint32(i,true)===0x02014b50){const size=view.getUint32(i+24,true);total+=size;entries++;if(size>12*1024*1024||total>25*1024*1024||entries>1000)throw new AppError("DOCX 解压内容过大，请精简后重新上传");const length=view.getUint16(i+28,true)+view.getUint16(i+30,true)+view.getUint16(i+32,true);i+=45+length;}}if(!entries)throw new AppError("DOCX 压缩结构无效");}
