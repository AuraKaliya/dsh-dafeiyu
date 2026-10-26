# 7C独立HTTP连接检查

2026-10-26。验收专用DeepSeek适配器增加`Connection: close`请求头；主模型语义参数、endpoint及禁止透明重试配置不变。没有修改产品Host或服务器。

通过本机回环HTTP服务调用实际安装的DeepSeek适配器两次：服务收到两笔请求、连接端口不同、Connection均为close；实际序列化的model、max_tokens=16384、thinking=enabled、effort=max一致。使用虚构密钥及模拟SSE响应，不接触真实凭据或模型服务。这验证当前本机协议实现，不证明公网问题已修复。

相关7/7通过，构建和类型检查通过；一次测试类型错误修正后复测。成功目录自动清理，记录见[JSON](results/integrated-7c2-connection-check.json)。将冻结新候选并重新执行完整五项校准，不把旧候选的二代结果拼接为新候选通过。
