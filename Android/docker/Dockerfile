# Written by Irmak Hakman — 2026-10-15 18:28
# Copyright (c) 2026 Irmak Hakman
# SPDX-License-Identifier: BUSL-1.1  (see LICENSE)
#
# The Android build tools, kept in a container so nothing is installed on the
# dev machine: JDK 17, the Android SDK command-line tools (platform 34,
# build-tools 34.0.0) and Gradle 8.7. Built once by ../build.sh.

FROM eclipse-temurin:17-jdk

RUN apt-get update \
 && apt-get install -y --no-install-recommends unzip wget \
 && rm -rf /var/lib/apt/lists/*

ENV ANDROID_HOME=/opt/android-sdk
RUN mkdir -p $ANDROID_HOME/cmdline-tools \
 && wget -q https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -O /tmp/tools.zip \
 && unzip -q /tmp/tools.zip -d $ANDROID_HOME/cmdline-tools \
 && mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest \
 && rm /tmp/tools.zip
ENV PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:/opt/gradle/bin

RUN yes | sdkmanager --licenses > /dev/null \
 && sdkmanager "platforms;android-34" "build-tools;34.0.0" "platform-tools" > /dev/null

RUN wget -q https://services.gradle.org/distributions/gradle-8.7-bin.zip -O /tmp/gradle.zip \
 && unzip -q /tmp/gradle.zip -d /opt \
 && mv /opt/gradle-8.7 /opt/gradle \
 && rm /tmp/gradle.zip

WORKDIR /project
