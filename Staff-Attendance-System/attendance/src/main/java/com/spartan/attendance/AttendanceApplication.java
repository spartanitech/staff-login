package com.spartan.attendance;

import java.util.TimeZone;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class AttendanceApplication {

    public static void main(String[] args) {
        // Every date/time in this system is IST, whatever the server's own zone is.
        TimeZone.setDefault(TimeZone.getTimeZone("Asia/Kolkata"));
        SpringApplication.run(AttendanceApplication.class, args);
    }
}
