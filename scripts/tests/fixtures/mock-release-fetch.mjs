import { appendFile } from "node:fs/promises";

const release = JSON.parse(process.env.ZHISHU_TEST_RELEASE);
const requestLog = process.env.ZHISHU_TEST_REQUEST_LOG;

globalThis.fetch = async (url) => {
  if (String(url) !== "https://api.github.com/repos/yadan177/ZhiShu/releases/latest") {
    throw new Error(`测试中出现意外网络请求：${url}`);
  }
  await appendFile(requestLog, `${url}\n`);
  return new Response(JSON.stringify(release), { status: 200 });
};
