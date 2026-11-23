/**
 * 004-result.md 的模板与校验。
 *
 * 模板文件是真源：templates/004-result.md。工具会把它的全文塞进错误信息里，
 * 这样执行者不需要去猜章节，也不需要读插件目录（它的 read 工具被限制在工作区内）。
 *
 * 校验只查一件事：「给人类的验收摘要」这一章存在，而且不是占位废话。
 */
import { readFileSync } from 'node:fs'

/** 模板文件缺失时的兜底文本，和 templates/004-result.md 保持一致。 */
const FALLBACK = `# 结果：<任务名>

## 给人类的验收摘要

**一句话结论**：<做成了 / 没做成，卡在哪一步>

**它到底做了什么**（用人话，不写函数名、不贴代码）：
- <第 1 件事，一句话>

**你怎么自己验证**（挑一个能双击或一行命令做完的）：
- 打开 \`<绝对路径>\`，应该看到 <画面或内容>

**没做成的部分**：<没有就写「没有」>

## 逐条验收对照

| 编号 | 结论 | 证据（人能看懂） |
| --- | --- | --- |
| A1 | ✅ 通过 | 打开 xxx，看到 yyy |
`

let cached

/** 读模板全文。 */
export function resultTemplate() {
  if (cached) return cached
  try {
    cached = readFileSync(new URL('../templates/004-result.md', import.meta.url), 'utf8')
  } catch {
    cached = FALLBACK
  }
  return cached
}

const HEADING = /^##\s*给人类的验收摘要\s*$/m

/**
 * 校验 004 正文。
 * @param {string} content
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function checkResultDoc(content) {
  if (!HEADING.test(content)) {
    return { ok: false, error: '缺少「## 给人类的验收摘要」这一章。验收的人看不懂你的日志，只能用这一章判断你做没做对。' }
  }
  const after = content.split(HEADING)[1] ?? ''
  const body = after.split(/^##\s/m)[0] ?? ''
  const words = body.replace(/\s+/g, '')
  if (words.length < 30) {
    return { ok: false, error: '「给人类的验收摘要」几乎是空的。至少写清楚：一句话结论、你做了什么、别人怎么自己验证。' }
  }
  if (/<[^<>\n]{2,40}>/.test(body)) {
    return { ok: false, error: '摘要里还留着模板占位符（<…>），换成真实内容再交。' }
  }
  return { ok: true }
}
