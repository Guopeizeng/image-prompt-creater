## Windows Launcher Compatibility Hotfix

- 修复首发包中 `.bat` 使用 LF 换行、PowerShell 脚本缺少 UTF-8 BOM 的兼容性缺陷。
- 新增纯英文安全入口：`00_START_PVOS_SAFE.bat`、`START_PVOS.bat`、`STOP_PVOS.bat`、`OPEN_ADMIN.bat`。
- `.bat` 统一为 ASCII-only + CRLF；`.ps1` 统一为 UTF-8 BOM + CRLF，以兼容 Windows PowerShell 5.1。
- 新增 `scripts/run_windows_launcher_audit.py`，发布前执行启动器字节级检查。

# PVOS V6.1.0 · Poster Structure Runtime 发布说明

## 这次修复的产品问题

V6.0.8.2 中，简单模式选择“海报结构参与”后，如果标题留空，前端会静默退回 `reserve-space`。豆包收到的任务仍然偏向“留出排版空间的人像底图”，而不是具有平面设计秩序的海报底图。

V6.1.0 新增 `poster-layout`：即使不填写标题，也会要求模型生成主标题容器、底部信息带、辅助色块、边界线和受控图层关系，同时禁止随机伪文字。

## 双轨输出

- 标题留空：`poster-layout`，生成无字海报骨架，准确文字后期叠加。
- 填写短标题：`integrated-text`，指定标题作为唯一刻意文字参与构图，并保留排版层用于校正。

## 版式模板图

模板图不是强制项。复杂拼贴、旧刊、票根、多画格等路线可以选择“已附模板图”，并将最后一张上传图片声明为版式参考。Prompt 会要求仅提取结构，不复制模板中的人物、人脸、品牌、可读文字、Logo、水印或具体内容。

## 验证边界

本地包只负责编译 Prompt，不直连豆包、即梦或 GPT 外部模型 API。因此，本包能够验证：模式选择、编译分支、Prompt 内容、HTTP 接口、前端静态资源、模块清单与启动器探针；模型实际出图效果仍需在真实豆包账号中进行人工验收。
