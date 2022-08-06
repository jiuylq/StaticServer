/**
 * @description 静态资源服务器，支持断点下载
 * @author jiuylq
 * 
 */

// node自带模块
const http = require('http');
const url = require('url');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');


// 第三方模块
const mime = require('mime');
const arttemplate = require('art-template');

// template
const templates = require('./compile');

class StaticServer {
  constructor(options) {
    this.host = options.host;
    this.port = options.port;
    this.rootPath = options.root; // process.cwd()
    this.cors = options.cors;
    // console.log(process.cwd())
  }

  /**
   * handler request
   * @param {*} req
   * @param {*} res
   */
  requestHandler(req, res) {
    const { pathname } = url.parse(req.url);
    const filepath = path.join(this.rootPath, pathname);
    console.log(pathname)
    if (pathname === '/') {
        const rootPath = path.join(this.rootPath, 'index.html');
        try{
            const indexStat = fs.statSync(rootPath);
            if (indexStat) {
                filepath = rootPath;
            }
        } catch(e) {

        }
    }

    // To check if a file exists
    fs.stat(filepath, (err, stat) => {
      if (!err) {
        if (stat.isDirectory()) {
          this.responseDirectory(req, res, filepath, pathname);
        } else {
          this.responseFile(req, res, filepath, stat);
        }
      } else {
        this.responseNotFound(req, res);
      }
    });
  }

  /**
   * Reads the contents of a directory , response files list to client
   * @param {*} req
   * @param {*} res
   * @param {*} filepath
   */
  responseDirectory(req, res, filepath, pathname) {
    fs.readdir(filepath, (err, files) => {
      if (!err) {
        const fileList = files.map(file => {
          const isDirectory = fs.statSync(filepath + '/' + file).isDirectory();
          return {
            filename: file,
            url: path.join(pathname, file),
            isDirectory
          };
        });
        // console.log(fileList)
        const html = arttemplate.compile(templates.fileList)({ title: pathname, fileList });
        res.setHeader('Content-Type', 'text/html');
        res.end(html);
      }
    });
  }

  /**
   * response resource
   * @param {*} req
   * @param {*} res
   * @param {*} filepath
   */
  async responseFile(req, res, filepath, stat) {
      console.log('11')
    this.cacheHandler(req, res, filepath, stat).then(
      data => {
        if (data === true) {
          res.writeHead(304);
          res.end();
        } else {
            console.log(req.headers);
          res.setHeader('Accept-Ranges', 'bytes');
            // console.log(stat.ctime.getTime())
          // 文件总大小，断点续传必须携带
          console.log('size', stat.size)
          res.setHeader('Content-Length', stat.size);
          // 资源最后修改时间
          res.setHeader('Last-Modified', stat.ctime.toGMTString());
          // http1.1内容 max-age=30 为强行缓存30秒 30秒内再次请求则用缓存  private 仅客户端缓存，代理服务器不可缓存
          res.setHeader('Cache-Control', `public,max-age=${30}`);
          // http1.0内容 作用与Cache-Control一致 告诉客户端什么时间，资源过期 优先级低于Cache-Control
          res.setHeader('Expires', new Date(Date.now() + 30 * 1000).toGMTString());
          res.setHeader('Content-Type', mime.getType(filepath) + ';charset=utf-8');
          // res.setHeader('Content-Type', 'applicatoin/octet-stream');
          res.setHeader('ETag', data);
          res.setHeader('Date', new Date().toGMTString());
          res.setHeader('Vary', 'Accept-Encoding,User-Agent');
          console.log(res.getHeader('Vary'))
          // response.setHeader('Vary', 'Accept-Encoding');
          // Access-Control-Max-Age
          // Access-Control-Allow-Credentials
          // 跨域
          this.cors && res.setHeader('Access-Control-Allow-Origin', '*');

          // 获取文件流，并支持断点续传
          const rs = this.getStream(req, res, filepath, stat);

          // 压缩，压缩后浏览器获取不了文件总大小
          const compress = this.compressHandler(req, res);
          if(rs) {
             if (compress) {
                 rs.pipe(compress).pipe(res);
             } else {
                rs.pipe(res);
             }
          } else {
              res.end('');
          }
        }
      },
      error => {
        this.responseError(req, res, error);
      }
    );
  }

  /**
   * To check if a file have cache
   * @param {*} req
   * @param {*} res
   * @param {*} filepath
   */
  cacheHandler(req, res, filepath, stat) {
    return new Promise((resolve, reject) => {
      // If-None-Match / ETag，Last-Modified / If-Modified-Since
      const readStream = fs.createReadStream(filepath);
      const ifNoneMatch = req.headers['if-none-match'];
      const ifModifiedSince = req.headers['if-modified-since'];
      const lastModified = stat.ctime.toGMTString();
      const reETag = `${stat.size}-${stat.mtime.getTime()}`
      console.log(ifNoneMatch, new Date(ifModifiedSince).getTime(), new Date(lastModified).getTime(), reETag, `${stat.size}-${stat.mtime.getTime()}`)
      let hash;
      // 限制最大文件hash的生成方式，如果文件太大通过MD5或SHA1生成hash过慢
      if (this.maxSize(stat, 0)) {
        hash = `${stat.size}-${stat.mtime.getTime()}`
        if (ifNoneMatch && ifNoneMatch != hash) {
            resolve(hash);
        }
        // 判断文件最后修改时间
        if (ifModifiedSince && ifModifiedSince != lastModified) {
            resolve(hash);
        }
        if (ifNoneMatch || ifModifiedSince) {
            resolve(true);
        }
        resolve(hash);
      } else {
        hash = crypto.createHash('md5');
        readStream.on('data', data => {
          hash.update(data);
        });

        readStream.on('end', () => {
          let etag = hash.digest('hex');
          if (ifNoneMatch === etag) {
            resolve(true);
          }
          resolve(etag);
        });

        readStream.on('error', err => {
          reject(err);
        });
      }
    });
  }
  
  /**
   * 断点续传支持
   * @param {*} req 
   * @param {*} res 
   * @param {*} filepath 
   * @param {*} statObj 
   */
  getStream(req, res, filepath, stat) {
      let size = stat.size;
      let start = 0;
      let end = size - 1;
      console.log(req.method)
      const range = req.headers['range'];
      console.log(req.headers);
      // if (!range) {
      //     return res.setHeader('Accept-Ranges', 'bytes');
      // }
      if (range) {
          let result = range.match(/bytes=(\d*)-(\d*)/);
          // res.setHeader('Accept-Range', result[1] + '-' + result[2] + '/' + size);
          if (result) {
              start = isNaN(result[1]) ? start : parseInt(result[1]);
              if(!result[2]) {
                  end = end
              } else {
                  end = isNaN(result[2]) ? end : parseInt(result[2]) - 1;
              }
          }
          console.log(start, end)
          // 检查请求范围
          if (start >= size || end >= size) {
              res.statusCode = 416;
              return res.setHeader('Content-Range', `bytes */${size}`);
          }

          // 206分部分响应
          // res.setHeader('Content-Range', 'bytes ' + start + '-' + end + '/' + size);
          // res.setHeader('Content-Length', size);
          res.statusCode = 206;
          res.setHeader('Accept-Ranges', 'bytes');
          res.setHeader('Content-Range', `bytes ${start}-${end ? end : size - 1}/${size}`);
      }
      console.log(start, end)
      return fs.createReadStream(filepath, {
          start, end
      });
  }

  /**
   * getRange file
   * @param {*} range
   * @return {Object}
   */
  getRange(range) {
      var result = range.match(/bytes=(\d*)-(\d*)/); // /bytes=([0-9]*)-([0-9]*)/.exec(range)
      const requestRange = {};
      if (result) {
          if (result[1]) requestRange.start = result[1];
          if (result[2]) requestRange.end = result[2];
      }
      return requestRange;
  }

  /**
   * maxsize file
   * @param {*} stat
   * @param {*} max
   * @return {Boolean}
   */
   maxSize(stat, max) {
       const bigsize = stat.size/1024;
       if(bigsize > max) {
           return true
       } else {
           return false;
       }
   }

  /**
   * compress file
   * @param {*} req
   * @param {*} res
   */
  compressHandler(req, res) {
    const acceptEncoding = req.headers['accept-encoding'];
    if (/\bgzip\b/.test(acceptEncoding)) {
      res.setHeader('Content-Encoding', 'gzip');
      return zlib.createGzip();
    } else if (/\bdeflate\b/.test(acceptEncoding)) {
      res.setHeader('Content-Encoding', 'deflate');
      return zlib.createDeflate();
    } else {
      return false;
    }
  }

  /**
   * not found request file
   * @param {*} req
   * @param {*} res
   */
  responseNotFound(req, res) {
    const html = arttemplate.compile(templates.notFound)();
    res.writeHead(404, {
      'Content-Type': 'text/html'
    });
    res.end(html);
  }

  /**
   * server error
   * @param {*} req
   * @param {*} res
   * @param {*} err
   */
  responseError(req, res, err) {
    res.writeHead(500);
    res.end(`there is something wrong in th server! please try later!`);
  }

  /**
   * server start
   */
  start() {
    const server = http.createServer((req, res) => this.requestHandler(req, res));
    server.listen(this.port, () => {
      console.log(`server started in http://${this.host}:${this.port}`);
    });
  }
}

module.exports = StaticServer;
