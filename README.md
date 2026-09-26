# 移动端语言听写练习工具（sologsb-1029）

面向手机使用的听写练习应用，包含学习端和教师反馈视图。课程、未提交答案、练习进度、逐词结果与反馈均保存在浏览器本地，可离线继续已下载课程。

## 功能

- 课程库：按课程和课节展示难度、句数、预计时长与下载状态。
- 离线课程：可切换课节下载标记；首次访问后由 Service Worker 缓存应用壳，断网重开仍可进入已下载课程并继续编辑。
- 听写流程：调用浏览器语音合成播放完整句子，输入答案后按句导航或整课提交。
- 逐词判错：使用词级序列比对识别拼写、漏词和多余词，并生成单句与整课得分。
- 错误复核：错误词可单独重听；可选择起止词重听指定片段；可为每个错误选择类别并记录原因。
- 教师反馈：教师视图可选择学生作答并写入反馈，反馈会回显在学习记录中。
- 错词复习台：每次提交的答错词自动收入复习台并绑定来源句；当天先练到期错词，答对一次记录一次，连续两次答对记为掌握，答错重新排到第二天；同一句的多个错词各自记进度，复习不影响原成绩与教师反馈。
- 复习台可播放原句片段、查看今日剩余数量，复习进度与到期日期保存在本机，重开不丢失。
- 进度恢复：保存每句答案和当前句，刷新、切换应用或手机旋转后可恢复。
- 可访问性：支持浅色/深色模式、五档字号区间、触控尺寸、键盘提交和减少动态效果偏好。
- 记录导出：将练习历史、逐词结果、错误分类、原因、教师反馈和错词复习记录（含练习次数与下次到期日期）导出为 JSON。

## 技术栈

- Vue 3
- TypeScript 5
- Varlet UI
- Vite 7

## 开发

```bash
npm install
npm run dev
```

开发服务器监听 `0.0.0.0`，适合通过局域网在手机浏览器中测试。宿主机正式端口按根目录 `docker-compose.yml` 映射为 `10029:80`。

## 类型检查与生产构建

```bash
npm run typecheck
npm run build
npm run preview
```

生产文件输出到 `dist/`。

## 复习逻辑测试

根目录的 `test-review.ts` 与 `test-migration.ts` 覆盖错词收录、连对掌握、答错重排、到期队列、旧数据迁移和导出字段，可用 esbuild 直接运行：

```bash
npx esbuild test-review.ts --bundle --platform=node --format=esm --outfile=/tmp/test-review.mjs && node /tmp/test-review.mjs
npx esbuild test-migration.ts --bundle --platform=node --format=esm --outfile=/tmp/test-migration.mjs && node /tmp/test-migration.mjs
```

## Docker

```bash
docker build -t sologsb-1029 .
docker run --rm -p 10029:80 sologsb-1029
```

最终镜像仅包含 nginx 和静态构建产物，nginx 监听容器 `80`。

## 数据说明

浏览器存储键为 `sologsb-1029-dictation-state-v1`。导出文件为 UTF-8 JSON，可用于后续学习分析。
