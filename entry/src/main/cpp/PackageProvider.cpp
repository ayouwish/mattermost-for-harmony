#include "RNOH/PackageProvider.h"
#include "RNOHGeneratedPackage.h"

std::vector<std::shared_ptr<rnoh::Package>>
rnoh::PackageProvider::getPackages(rnoh::Package::Context ctx) {
  return {std::make_shared<RNOHGeneratedPackage>(ctx)};
}
