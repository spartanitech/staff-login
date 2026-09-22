package com.spartan.attendance.config;

import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Hibernate's "ddl-auto=update" adds new tables and columns but never alters an existing one. Older versions of this
 * app let Hibernate create audit_logs.action as a MySQL ENUM(...) that only lists the actions known at the time, so the
 * first new audit action (e.g. SHOP_CREATE) would be rejected with "Data truncated". This one-off step turns that column
 * into plain text. It does nothing when the column is already text (new databases, H2 in tests) and never blocks startup.
 */
@Slf4j
@Component
@Order(1)
@RequiredArgsConstructor
public class SchemaMigrator implements ApplicationRunner {

    private final JdbcTemplate jdbc;

    @Override
    public void run(ApplicationArguments args) {
        try {
            List<String> types = jdbc.queryForList(
                    "select data_type from information_schema.columns "
                            + "where table_schema = database() and table_name = 'audit_logs' and column_name = 'action'",
                    String.class);
            if (!types.isEmpty() && "enum".equalsIgnoreCase(types.get(0))) {
                jdbc.execute("alter table audit_logs modify column action varchar(40) not null");
                log.info("Migrated audit_logs.action from an ENUM column to VARCHAR(40).");
            }
        } catch (Exception e) {
            log.warn("Could not check/migrate audit_logs.action ({}). If a new audit action fails with 'Data truncated', "
                    + "run: ALTER TABLE audit_logs MODIFY COLUMN action VARCHAR(40) NOT NULL;", e.getMessage());
        }
    }
}
