# H5 MySQL上线执行清单

> 适用发布：2026-05-29 P7设计稿二维码、未注册手机号领券失败不扣摇签机会、新签文库。

## 执行表格

| 顺序 | 执行阶段 | 运维执行内容 | 脚本/命令 | 成功标准 |
| --- | --- | --- | --- | --- |
| 1 | 确认目标库 | 确认即将执行的是H5活动线上库，不是测试库或其他项目库。 | `SELECT DATABASE(), @@version;` | 库名与发布单一致，MySQL建议为8.0。 |
| 2 | 备份 | 执行线上库备份，保留回滚点。 | `mysqldump --single-transaction --default-character-set=utf8mb4 -h <host> -P 3306 -u <user> -p <database> > gaokao_h5_20260529_before_release.sql` | 备份文件生成且大小正常。 |
| 3 | 执行发布SQL | 从项目根目录执行上线总脚本。 | `mysql --default-character-set=utf8mb4 -h <host> -P 3306 -u <user> -p <database> < database/mysql/release_20260529_h5_ops.sql` | 输出 `release_20260529_h5_ops_done`。 |
| 4 | 执行校验SQL | 对同一个库执行校验脚本。 | `mysql --default-character-set=utf8mb4 -h <host> -P 3306 -u <user> -p <database> < database/mysql/release_20260529_h5_verify.sql` | 签文启用数量为20，P7二维码配置存在，券配置存在，`change_type`约束包含`rollback`。 |
| 5 | 切MySQL运行 | 后端发布环境设置MySQL变量后重启服务。 | `GAOKAO_H5_DB_ENGINE=mysql` 以及 `GAOKAO_H5_MYSQL_*` | `/api/health`返回正常，数据库引擎为MySQL。 |
| 6 | 业务验收 | H5抽签、领券、未注册手机号失败弹小程序码并补回机会。 | 浏览器或测试账号操作 | 未注册手机号失败后“我的摇签机会”不减少。 |

## 注意事项

- 不要清库，不要执行`TRUNCATE`，不要从SQLite导入线上库。
- `release_20260529_h5_ops.sql`会执行现有MySQL建表脚本和配置更新脚本，配置更新使用`ON DUPLICATE KEY UPDATE`。
- 旧线上库如果已经存在`draw_chance_log`表，脚本会把`change_type`的CHECK约束替换成包含`rollback`的新约束，用于支持未注册手机号领券失败时补回机会。
- 必须从项目根目录执行，因为上线总脚本内部使用了相对路径`SOURCE database/mysql/...`。
- 线上密码、库名、账号由运维在命令里替换，不要写入Git。

## 后端环境变量

```bash
GAOKAO_H5_DB_ENGINE=mysql
GAOKAO_H5_MYSQL_HOST=<host>
GAOKAO_H5_MYSQL_PORT=3306
GAOKAO_H5_MYSQL_DATABASE=<database>
GAOKAO_H5_MYSQL_USER=<user>
GAOKAO_H5_MYSQL_PASSWORD=<password>
GAOKAO_H5_MYSQL_CONNECT_TIMEOUT=10
```
