package com.spartan.attendance.config;

import java.time.DayOfWeek;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/** Typed view of the "app.*" block in application.properties. */
@Component
@ConfigurationProperties(prefix = "app")
@Getter
@Setter
public class AppProperties {

    private Jwt jwt = new Jwt();
    private Admin admin = new Admin();
    private Attendance attendance = new Attendance();
    private Cors cors = new Cors();
    private Seed seed = new Seed();

    @Getter
    @Setter
    public static class Jwt {
        private String secret = "";
        private long expirationMinutes = 480;
        private String issuer = "spartan-staff-attendance";
    }

    @Getter
    @Setter
    public static class Admin {
        private String username = "Admin";
        private String password = "Admin@123";
        private String name = "Administrator";
        private String employeeCode = "ADM001";
        private boolean resetPassword = false;
    }

    @Getter
    @Setter
    public static class Attendance {
        private String zone = "Asia/Kolkata";
        private LocalTime shiftStart = LocalTime.of(9, 30);
        private int lateGraceMinutes = 15;
        private int halfDayMinutes = 240;
        private double maxAccuracyMeters = 100;
        private DayOfWeek weeklyOff = DayOfWeek.SUNDAY;
        /** Default "stand this close to the shop" radius for a new shop (each shop can override it). */
        private int shopRadiusMeters = 50;
        /** Where the live shop photos taken at check-in are stored (a folder on the server, never inside the web root). */
        private String photoDir = System.getProperty("user.home") + "/.staff-attendance/photos";
        private long maxPhotoBytes = 5L * 1024 * 1024;
    }

    @Getter
    @Setter
    public static class Cors {
        private List<String> allowedOrigins = new ArrayList<>();
    }

    @Getter
    @Setter
    public static class Seed {
        private boolean demoUsers = true;
    }
}
