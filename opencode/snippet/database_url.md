---
description: DATABASE_PASSWORD 技巧
---

我還希望搭配 DATABASE_PASSWORD 的組合機制
舉個例子
DATABASE_URL = "mysql://user:pass@localhost/test"
DATABASE_PASSWORD = "readpass"
最終組合為 "mysql://user:readpass@localhost/test"
但 DATABASE_PASSWORD 是可選的