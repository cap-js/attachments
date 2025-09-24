const fs = require('fs').promises

async function commentAnnotation(filePath, linesToComment) {
  try {
    const data = await fs.readFile(filePath, 'utf8')

    const lines = data.split('\n').map(line => {
      if (linesToComment.some(substring => line.includes(substring)) && !line.trim().startsWith('//')) {
        return `// ${line}`
      }
      return line
    })

    const modifiedData = lines.join('\n')
    await fs.writeFile(filePath, modifiedData, 'utf8')
    process.stdout.write(`File ${filePath} updated successfully.`)
  } catch (err) {
    process.stdout.write(`Error processing file ${filePath}:`, err)
    throw err
  }
}

async function uncommentAnnotation(filePath, linesToUncomment) {
  try {
    const data = await fs.readFile(filePath, 'utf8')

    const lines = data.split('\n').map(line => {
      if (linesToUncomment.some(substring => line.includes(substring)) && line.trim().startsWith('//')) {
        return line.replace(/^\/\/\s?/, '')
      }
      return line
    })

    const modifiedData = lines.join('\n')
    await fs.writeFile(filePath, modifiedData, 'utf8')
    process.stdout.write(`File ${filePath} updated successfully.`)
  } catch (err) {
    process.stdout.write(`Error processing file ${filePath}:`, err)
    throw err
  }
}

module.exports = {
  commentAnnotation,
  uncommentAnnotation
}
