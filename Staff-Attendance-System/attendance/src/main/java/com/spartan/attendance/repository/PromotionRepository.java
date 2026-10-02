package com.spartan.attendance.repository;

import com.spartan.attendance.entity.Promotion;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PromotionRepository extends JpaRepository<Promotion, Long> {

    List<Promotion> findAllByOrderByIdAsc();

    Optional<Promotion> findByClientRef(String clientRef);

    boolean existsByKind(String kind);
}
