package com.spartan.attendance.config;

import com.spartan.attendance.entity.Role;
import com.spartan.attendance.entity.Shop;
import com.spartan.attendance.entity.Status;
import com.spartan.attendance.entity.User;
import com.spartan.attendance.repository.ShopRepository;
import com.spartan.attendance.repository.UserRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Runs at every startup.
 *  1. Guarantees the bootstrap Admin exists as ROLE=ADMIN, STATUS=ACTIVE with a BCrypt hash - and REPAIRS an
 *     existing row that has the wrong role/status (the "Supervisor -> Admin" leftover case).
 *  2. Optionally seeds the old demo staff (and a few demo shops assigned to the demo Sales Officers) for local testing.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class DataInitializer implements ApplicationRunner {

    private static final String DEFAULT_ADMIN_PASSWORD = "Admin@123";

    private final UserRepository userRepository;
    private final ShopRepository shopRepository;
    private final PasswordEncoder passwordEncoder;
    private final AppProperties props;
    private final Environment environment;

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        ensureAdmin();
        if (props.getSeed().isDemoUsers() && !environment.acceptsProfiles(Profiles.of("prod"))) {
            seedDemoStaff();
            seedDemoShops();
        }
    }

    private void ensureAdmin() {
        AppProperties.Admin cfg = props.getAdmin();
        if (environment.acceptsProfiles(Profiles.of("prod")) && DEFAULT_ADMIN_PASSWORD.equals(cfg.getPassword())) {
            throw new IllegalStateException("Refusing to start in prod with the default Admin password. Set ADMIN_PASSWORD.");
        }
        User admin = userRepository.findByUsernameIgnoreCase(cfg.getUsername()).orElse(null);
        if (admin == null) {
            userRepository.save(User.builder()
                    .employeeCode(cfg.getEmployeeCode())
                    .name(cfg.getName())
                    .username(cfg.getUsername())
                    .passwordHash(passwordEncoder.encode(cfg.getPassword()))
                    .role(Role.ADMIN)
                    .designation("Administrator")
                    .status(Status.ACTIVE)
                    .build());
            log.info("Created bootstrap Admin account '{}' (role ADMIN, status ACTIVE).", cfg.getUsername());
            return;
        }
        boolean changed = false;
        if (admin.getRole() != Role.ADMIN) {
            log.warn("Account '{}' had role {} - repairing to ADMIN.", admin.getUsername(), admin.getRole());
            admin.setRole(Role.ADMIN);
            changed = true;
        }
        if (admin.getStatus() != Status.ACTIVE) {
            log.warn("Account '{}' was {} - repairing to ACTIVE.", admin.getUsername(), admin.getStatus());
            admin.setStatus(Status.ACTIVE);
            changed = true;
        }
        if (!admin.getUsername().equals(cfg.getUsername())) {
            admin.setUsername(cfg.getUsername());
            changed = true;
        }
        if (cfg.isResetPassword()) {
            admin.setPasswordHash(passwordEncoder.encode(cfg.getPassword()));
            log.warn("ADMIN_RESET_PASSWORD=true: Admin password reset to the configured value. Turn the flag off again.");
            changed = true;
        }
        if (changed) {
            userRepository.save(admin);
        }
    }

    private void seedDemoStaff() {
        if (userRepository.existsByUsernameIgnoreCase("owner01")) {
            return;   // already seeded
        }
        User owner = demo("OWN001", "Rajesh Sharma", "owner01", "password123", Role.OWNER, "Owner", null, null, null);
        User rsm = demo("RSM001", "Ramesh Kumar", "marketing01", "password123", Role.RSM, "Marketing Manager", null, null, owner);
        User rm = demo("RM001", "Suresh Babu", "regional01", "password123", Role.RM, "Regional Manager", null, "South", rsm);
        User asm1 = demo("ASM001", "Karthik Raja", "areasales01", "Asm@123", Role.ASM, "Area Sales Manager", "Madurai", "South", rm);
        User asm2 = demo("ASM002", "Arul Prakash", "areasales02", "Asm@123", Role.ASM, "Area Sales Manager", "Chennai", "North", rm);
        demo("SO001", "Ravi", "sales01", "Sales@123", Role.SO, "Sales Officer", "Madurai", "South", asm1);
        demo("SO002", "Murugan", "sales02", "Sales@123", Role.SO, "Sales Officer", "Theni", "South", asm1);
        demo("SO003", "Kumar", "sales03", "Sales@123", Role.SO, "Sales Officer", "Chennai", "North", asm2);
        log.info("Seeded {} demo staff accounts (local development only - set SEED_DEMO_USERS=false to disable).",
                List.of(owner, rsm, rm, asm1, asm2).size() + 3);
    }

    /**
     * Local development only. A few shops per demo Sales Officer so the shop check-in can be tried straight away; real
     * shops are added by the Admin (Shops section). Runs once, only while the shops table is still empty.
     */
    private void seedDemoShops() {
        if (shopRepository.count() > 0) {
            return;
        }
        int radius = props.getAttendance().getShopRadiusMeters();
        int made = 0;
        made += demoShop("sales01", "SHP001", "Sri Ganesh Stores", "Anna Nagar", "North", "Anna Nagar, Madurai - 625020", 9.9382, 78.0878, radius);
        made += demoShop("sales01", "SHP002", "Spartan Capital Enterprises", "Kochadai", "West",
                "16/1, Virudhachalam Street, Natraj Nagar, Kochadai Main Road, Madurai - 625016", 9.9354, 78.0918, radius);
        made += demoShop("sales01", "SHP003", "Sri Murugan Traders", "Mattuthavani", "East", "Mattuthavani, Madurai - 625007", 9.9440, 78.1550, radius);
        made += demoShop("sales02", "SHP004", "Vetri Provisions", "Rajaji Nagar", "South", "Rajaji Nagar, Theni - 625531", 10.0104, 77.4768, radius);
        made += demoShop("sales02", "SHP005", "Annai Stores", "Gandhi Nagar", "North", "Gandhi Nagar, Theni - 625531", 10.0136, 77.4802, radius);
        made += demoShop("sales03", "SHP006", "Kaveri Mart", "T. Nagar", "South", "T. Nagar, Chennai - 600017", 13.0418, 80.2341, radius);
        made += demoShop("sales03", "SHP007", "Global Traders", "Adyar", "East", "Adyar, Chennai - 600020", 13.0067, 80.2570, radius);
        if (made > 0) {
            log.info("Seeded {} demo shops (local development only).", made);
        }
    }

    private int demoShop(String officerUsername, String code, String name, String locality, String region, String address,
                         double lat, double lng, int radius) {
        User officer = userRepository.findByUsernameIgnoreCase(officerUsername).orElse(null);
        if (officer == null) {
            return 0;
        }
        shopRepository.save(Shop.builder()
                .code(code).name(name).locality(locality).region(region).address(address)
                .latitude(lat).longitude(lng).allowedRadiusMeters(radius)
                .assignedOfficer(officer).status(Status.ACTIVE)
                .build());
        return 1;
    }

    private User demo(String code, String name, String username, String password, Role role, String designation,
                      String area, String region, User manager) {
        return userRepository.save(User.builder()
                .employeeCode(code).name(name).username(username)
                .passwordHash(passwordEncoder.encode(password))
                .role(role).designation(designation).area(area).region(region)
                .status(Status.ACTIVE).reportingManager(manager)
                .build());
    }
}
