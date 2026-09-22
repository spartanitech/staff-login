# ---------- Stage 1: build the jar with Maven ----------
FROM maven:3.9.9-eclipse-temurin-21 AS build
WORKDIR /build
COPY pom.xml .
RUN mvn -B dependency:go-offline
COPY src ./src
RUN mvn -B clean package -DskipTests

# ---------- Stage 2: small runtime image ----------
FROM eclipse-temurin:21-jre-jammy
WORKDIR /app
RUN groupadd -r attendance && useradd -r -g attendance attendance \
    && mkdir -p /data/photos && chown -R attendance:attendance /data
COPY --from=build /build/target/*.jar app.jar
USER attendance
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
