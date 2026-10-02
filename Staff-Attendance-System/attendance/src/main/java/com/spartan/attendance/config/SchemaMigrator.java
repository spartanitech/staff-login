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
        dropAuditActionChecks();
        backfillStockTotals();
    }

    /**
     * Hibernate 6 writes the enum's values at create time into a CHECK constraint on audit_logs.action
     * ("check (action in ('LOGIN', ..., 'SHOP_DELETE'))"), and MySQL 8.0.16+ enforces it. ddl-auto=update never
     * refreshes that list, so every audit action added later (TEAM_ASSIGN for "Save team") is rejected by the
     * database and the whole request rolls back with a 500. The column is validated by the Java enum already, so the
     * CHECK is dropped here. Does nothing when there is no such constraint.
     */
    private void dropAuditActionChecks() {
        List<String> names;
        try {
            names = jdbc.queryForList(
                    "select tc.constraint_name from information_schema.table_constraints tc "
                            + "join information_schema.check_constraints cc "
                            + "on cc.constraint_schema = tc.constraint_schema and cc.constraint_name = tc.constraint_name "
                            + "where tc.table_schema = database() and tc.table_name = 'audit_logs' "
                            + "and tc.constraint_type = 'CHECK' and lower(cc.check_clause) like '%action%'",
                    String.class);
        } catch (Exception e) {
            log.debug("Skipped audit_logs CHECK lookup ({}).", e.getMessage());
            return;
        }
        for (String name : names) {
            String quoted = "`" + name.replace("`", "``") + "`";
            try {
                jdbc.execute("alter table audit_logs drop check " + quoted);              // MySQL 8.0.16+
                log.info("Dropped CHECK constraint {} on audit_logs.action (it blocked new audit actions).", name);
            } catch (Exception first) {
                try {
                    jdbc.execute("alter table audit_logs drop constraint " + quoted);     // MariaDB
                    log.info("Dropped CHECK constraint {} on audit_logs.action (it blocked new audit actions).", name);
                } catch (Exception e) {
                    log.warn("Could not drop CHECK {} on audit_logs ({}). Run: ALTER TABLE audit_logs DROP CHECK {};",
                            name, e.getMessage(), quoted);
                }
            }
        }
    }

    /**
     * stock_entries.total_stock / total_sales were added later; rows saved before that have 0 in both. Fill them in
     * from the numbers already on the row (Total Stock = opening + receipt, Total Sales = SO sales + DP sales).
     */
    private void backfillStockTotals() {
        try {
            int n = jdbc.update("update stock_entries set total_stock = opening + receipt, total_sales = so_sales + dp_sales "
                    + "where total_stock <> opening + receipt or total_sales <> so_sales + dp_sales");
            if (n > 0) {
                log.info("Filled Total Stock / Total Sales on {} older stock row(s).", n);
            }
        } catch (Exception e) {
            log.warn("Could not back-fill stock_entries totals ({}).", e.getMessage());
        }
    }
}
