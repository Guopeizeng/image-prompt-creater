# PVOS V6.1.1 · Poster Structure Runtime 发布说明

## 这次变更的范围

V6.1.1 是 **metadata + 标注** 类型的 minor bump：

- **没有任何新的海报策略、新规则或新编译逻辑**。
- 提示词编译结果与 V6.1.0 完全一致。
- 主要工作是给两条提示词适配线打上"成熟度"标签，让用户一眼看清谁可以信任、谁还在路上。

## 提示词适配成熟度

| 适配线 | V6.1.0 状态 | V6.1.1 状态 | 说明 |
|---|---|---|---|
| GPT 生图（`gpt-image`） | 唯一主线 | **主线（`stable`）** | 当前唯一相对完善的主线，推荐日常使用。 |
| 豆包 Seedream（`doubao-seedream`） | 与 GPT 同列 | **测试版（`test`）** | 中文整句强约束结构仅做基础编译，欢迎试用但**不要作为唯一交付路径**。 |

数据来源：`library/provider_profiles.json`，`provider_profiles.py` 校验器新增 `maturity` 字段白名单（`stable` / `test` / `experimental`），默认 `stable`，非法值会让服务启动失败。

Provider-profile 协议从 `pvos-provider-profiles@1.1.0` 升到 `1.2.0`，仅添加字段，不改旧字段语义；老配置仍然兼容。

## 用户能看到的变化

1. **豆包按钮带"测试版"角标**（橙色，hover 提示当前为测试版本）。
2. **选中豆包时**：
   - 工作台标题变成"豆包 Seedream Prompt（测试版）"。
   - 底部元信息变成"提示词适配：豆包 Seedream（测试版） · 通过 Core API 编译"。
   - 提示词统计行追加"豆包 Seedream · 测试版"和一条独立的警告条。
3. **GPT 按钮没有任何角标**（绿色"主线"标签需要手动悬停查看，刻意保持低调）。
4. **provider-bar 的提示语**改为"GPT 线是当前唯一相对完善的主线；豆包线为测试版本……"。

## 不在这次变更里

- **没有**改任何 GPT 编译分支、任何豆包编译分支、任何模板参考规则、任何海报骨架策略。
- **没有**改 Visual Core 5.16.1 内的任何资产。
- **没有**改启动器（`00_START_PVOS_SAFE.bat`、`scripts/start_local_windows.ps1` 等）的字节级编码要求；版本字符串从 `V6.1.0` → `V6.1.1`、`v6100-20260612` → `v6101-20260612`，但兼容性检查逻辑没有变。
- **没有**改 ZIP 完整性、字体资产策略、模块哈希策略。

## 升级方式

完整解压后双击 `00_START_PVOS_SAFE.bat`。旧 V6.1.0 用户的本地 `data/`、`uploads/`、`private_assets/`、`logs/` 都不需要迁移，配置和会话状态保留。

## 验证边界

本地包只负责编译 Prompt，不直连豆包、即梦或 GPT 外部模型 API。因此，本包能够验证：模式选择、编译分支、Prompt 内容、HTTP 接口、前端静态资源、模块清单与启动器探针；模型实际出图效果仍需在真实豆包账号中进行人工验收。

## 后续路径

豆包线如要做到与 GPT 同等成熟，至少需要：

1. 完成真实豆包账号的多路线回归集（建议 ≥20 个路线 × ≥3 个密度档）。
2. 解决"`【海报骨架】` 段落下豆包偶发文字漏出"等已知问题（参考 issue tracker）。
3. parity audit 通过后，将 `library/provider_profiles.json` 中 `maturity` 改为 `stable`，再发 V6.2.0。
