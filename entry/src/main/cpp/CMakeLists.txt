cmake_minimum_required(VERSION 3.13)

set(MUSL_ASSERT_H "F:/Program Files/DevEco Studio/sdk/default/openharmony/native/sysroot/usr/include/assert.h")

add_compile_options(
    "$<$<COMPILE_LANGUAGE:CXX>:-include>"
    "$<$<COMPILE_LANGUAGE:CXX>:${MUSL_ASSERT_H}>"
)

project(rnoh_app)

set(RNOH_CPP_DIR
    "${CMAKE_CURRENT_SOURCE_DIR}/../../../oh_modules/@rnoh/react-native-openharmony/src/main/cpp"
)

add_subdirectory("${RNOH_CPP_DIR}" "${CMAKE_CURRENT_BINARY_DIR}/rnoh_build")

file(GLOB GENERATED_CPP_SOURCES CONFIGURE_DEPENDS
    "generated/*.cpp"
)

add_library(rnoh_app SHARED
    "${RNOH_CPP_DIR}/RNOHAppNapiBridge.cpp"
    "PackageProvider.cpp"
    ${GENERATED_CPP_SOURCES}
)

target_include_directories(rnoh_app PRIVATE
    "${RNOH_CPP_DIR}"
    "${CMAKE_CURRENT_SOURCE_DIR}"
    "${CMAKE_CURRENT_SOURCE_DIR}/generated"
)

target_link_libraries(rnoh_app PUBLIC rnoh)
