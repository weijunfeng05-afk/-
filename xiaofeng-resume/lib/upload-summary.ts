export function uploadSummary(queue: {state: string}[]): string {
 const pending = queue.filter(item => ['等待上传', '正在上传'].includes(item.state)).length;
 const accepted = queue.filter(item => item.state.startsWith('已上传，')).length;
 const failed = queue.length - pending - accepted;
 return '已处理 ' + (queue.length - pending) + ' / ' + queue.length + ' · 上传成功 ' + accepted + ' · 失败 ' + failed;
}
