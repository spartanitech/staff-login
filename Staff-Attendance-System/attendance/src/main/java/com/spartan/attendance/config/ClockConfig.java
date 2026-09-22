package com.spartan.attendance.config;

import java.time.Clock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import com.spartan.attendance.util.TimeUtil;

@Configuration
public class ClockConfig {

    /** All "now" reads go through this bean (IST), which also lets tests substitute a fixed clock. */
    @Bean
    public Clock clock() {
        return Clock.system(TimeUtil.IST);
    }
}
