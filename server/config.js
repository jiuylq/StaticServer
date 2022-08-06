/**
 * @description config
 * @author jiuylq
*/

module.exports = {
     root: './files', // process.cwd()
     host: '0.0.0.0',
     port: '8088',
     cors: {
         open: true,
         origin: ''
     },
     cache: {
         maxAge: 24 * 60 * 60 * 365,
         expires: true,
         cacheControl: true,
         lastModified: true,
         etag: true
     }
}
