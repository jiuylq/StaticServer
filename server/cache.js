const config = require('./config')

/**
 * 
 * Pragma HTTP1.0时的遗留字段，当值为"no-cache"时强制验证缓存
 * Date 创建报文的日期时间(启发式缓存阶段会用到这个字段)
 * ETag 服务器生成资源的唯一标识
 * Cache-Control 控制缓存具体的行为
 * Expires 告知客户端资源缓存失效的绝对时间
 * Last-Modified 资源最后一次修改的时间
 * Vary 代理服务器缓存的管理信息
 * Age 资源在缓存代理中存贮的时长(取决于max-age和s-maxage的大小)
 * If-Match 条件请求，携带上一次请求中资源的ETag，服务器根据这个字段判断文件是否有新的修改
 * If-None-Match 和If-Match作用相反，服务器根据这个字段判断文件是否有新的修改
 * If-Modified-Since 	比较资源前后两次访问最后的修改时间是否一致
 * If-Unmodified-Since 比较资源前后两次访问最后的修改时间是否一致
 * 强缓存 Cache-Control > Expires，协商缓存 ETag > Last-Modified
 * 当缓存过期时间的字段一个都没有时使用"启发式缓存阶段",根据响应头中2个时间字段 Date 和 Last-Modified 之间的时间差值，取其值的10%作为缓存时间周期。
 */

const t = new Date();

module.exports = function httpCache(req, res, stats) {
    const {maxAge, expires, cacheControl, lastModified, etag} = config.cache;
}

function refreshRes (stats, response) {
  
  const {maxAge, expires, cacheControl, lastModified, etag} = config.cache;

  if (expires) {
    response.setHeader('Expires', (new Date(Date.now() + maxAge * 1000)).toUTCString());
  }
  if (cacheControl) {
    response.setHeader('Cache-Control', `public, max-age=${maxAge}`);
  }
  if (lastModified) {
    response.setHeader('Last-Modified', stats.mtime.toUTCString());
  }
  if (etag) {
    response.setHeader('ETag', `${stats.size}-${stats.mtime.toUTCString()}`); // mtime 需要转成字符串，否则在 windows 环境下会报错
  }
  response.setHeader('Date', `${stats.size}-${stats.mtime.getTime()}`);
}

module.exports = function isFresh (stats, request, response) {
  // If-None-Match / ETag，Last-Modified / If-Modified-Since
  refreshRes(stats, response);
  const lastModified = request.headers['if-modified-since'];
  const etag = request.headers['if-none-match'];
  // const ifNoneMatch = request.headers['if-none-match']; // 上次的ETag
  // const ifModifiedSince = request.headers['if-modified-since']; // 上次携带的服务端返回的Last-Modified（文件最后一次修改的时间）
    console.log(lastModified,etag,response.getHeader('ETag'),response.getHeader('Last-Modified'))
  if (!lastModified && !etag) {
    return false;
  }
  if (lastModified && lastModified !== response.getHeader('Last-Modified')) {
    return false;
  }
  if (etag && etag !== response.getHeader('ETag')) {
    return false;
  }
  return true;
};