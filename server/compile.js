const path = require('path');
const fs = require('fs');

/**
 * @description 模板文件解析
 * @aythor jiuylq
 * @return
*/

const fileList = fs.readFileSync(path.resolve(__dirname, 'template', 'list.art'), 'utf8');

const notFound = fs.readFileSync(path.resolve(__dirname, 'template', '404.art'), 'utf8');

module.exports = {
    fileList,
    notFound
}