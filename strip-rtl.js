const fs = require('fs')
const path = require('path')

function processDirectory(dirPath) {
  const files = fs.readdirSync(dirPath)

  for (const file of files) {
    const fullPath = path.join(dirPath, file)
    const stat = fs.statSync(fullPath)

    if (stat.isDirectory()) {
      processDirectory(fullPath)
    } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
      let content = fs.readFileSync(fullPath, 'utf8')
      let changed = false

      if (content.includes('dir="rtl"')) {
        content = content.replace(/ dir="rtl"/g, '')
        changed = true
      }
      
      // Also fix rounded-r-full or pl-6 specific logic to be logical properties? 
      // Tailwind logical properties like ms-, me-, ps-, pe-, rounded-e-full
      if (content.includes('rounded-r-full')) {
        content = content.replace(/rounded-r-full/g, 'rounded-e-full')
        changed = true
      }
      if (content.includes('rounded-r-3xl')) {
        content = content.replace(/rounded-r-3xl/g, 'rounded-e-3xl')
        changed = true
      }
      if (content.includes('pr-')) {
        content = content.replace(/pr-/g, 'pe-')
        changed = true
      }
      if (content.includes('pl-')) {
        content = content.replace(/pl-/g, 'ps-')
        changed = true
      }
      if (content.includes('mr-')) {
        content = content.replace(/mr-/g, 'me-')
        changed = true
      }
      if (content.includes('ml-')) {
        content = content.replace(/ml-/g, 'ms-')
        changed = true
      }
      if (content.includes('text-right')) {
        content = content.replace(/text-right/g, 'text-start')
        changed = true
      }
      if (content.includes('text-left')) {
        content = content.replace(/text-left/g, 'text-end')
        changed = true
      }
      if (content.includes('right-')) {
        content = content.replace(/right-/g, 'end-')
        changed = true
      }
      if (content.includes('left-')) {
        content = content.replace(/left-/g, 'start-')
        changed = true
      }

      if (changed) {
        fs.writeFileSync(fullPath, content, 'utf8')
        console.log(`Updated layout properties in ${fullPath}`)
      }
    }
  }
}

processDirectory(path.join(__dirname, 'src'))
