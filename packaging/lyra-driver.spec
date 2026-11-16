Name:           lyra-driver
Version:        0.1.0
Release:        0
%global debug_package %{nil}
Summary:        Install and maintain third-party drivers on Lyra OS
License:        GPL-3.0-only
URL:            https://github.com/lyra-os-linux/lyra-driver
Source0:        %{name}-%{version}.tar.zst
Source1:        vendor.tar.zst
BuildRequires:  cargo
BuildRequires:  cargo-packaging
BuildRequires:  desktop-file-utils
BuildRequires:  gtk3-devel
BuildRequires:  libsoup-devel
BuildRequires:  pkgconfig
BuildRequires:  rust >= 1.85
BuildRequires:  webkit2gtk3-devel
BuildRequires:  zstd
Requires:       bash
Requires:       coreutils
# Detecção (lspci) e o helper privilegiado.
Requires:       pciutils
Requires:       polkit
Requires:       zypper
Requires:       curl
Requires:       gpg2
Requires:       rpm
Requires:       systemd
Recommends:     snapper

%description
Lyra Driver detects hardware that needs a third-party driver and installs,
tests, updates, reinstalls or removes it. The first supported driver is the
official NVIDIA driver for openSUSE Leap 16.1, following the Lyra OS forum
guide: the NVIDIA graphics repository is added directly, its signing key is
verified before it is trusted, and a Snapper snapshot is taken before every
change. Privileged actions run through a fixed helper authorized by polkit.

%prep
%autosetup -a1
sed -i 's|^directory = .*|directory = "vendor"|' src-tauri/.cargo/config.toml
test -d src-tauri/vendor

%build
cd src-tauri
%{cargo_build}

%install
install -Dm0755 src-tauri/target/release/lyra-driver \
    %{buildroot}%{_bindir}/lyra-driver
install -Dm0755 helper/lyra-driver-helper \
    %{buildroot}%{_libexecdir}/lyra-driver/lyra-driver-helper
install -Dm0644 data/org.lyraos.driver.policy \
    %{buildroot}%{_datadir}/polkit-1/actions/org.lyraos.driver.policy
install -Dm0644 packaging/org.lyraos.LyraDriver.desktop \
    %{buildroot}%{_datadir}/applications/org.lyraos.LyraDriver.desktop
install -Dm0644 packaging/org.lyraos.LyraDriver-autostart.desktop \
    %{buildroot}%{_sysconfdir}/xdg/autostart/org.lyraos.LyraDriver-check.desktop
install -Dm0644 packaging/org.lyraos.LyraDriver.svg \
    %{buildroot}%{_datadir}/icons/hicolor/scalable/apps/org.lyraos.LyraDriver.svg
install -dm0755 %{buildroot}%{_sharedstatedir}/lyra-driver
%{__strip} --strip-all %{buildroot}%{_bindir}/lyra-driver
desktop-file-validate %{buildroot}%{_datadir}/applications/org.lyraos.LyraDriver.desktop
desktop-file-validate %{buildroot}%{_sysconfdir}/xdg/autostart/org.lyraos.LyraDriver-check.desktop

%check
cd src-tauri
cargo test --offline --release
cd ..
bash -n helper/lyra-driver-helper
bash tests/helper.sh

%files
%license LICENSE
%doc README.md
%{_bindir}/lyra-driver
%dir %{_libexecdir}/lyra-driver
%{_libexecdir}/lyra-driver/lyra-driver-helper
%dir %{_datadir}/polkit-1
%dir %{_datadir}/polkit-1/actions
%{_datadir}/polkit-1/actions/org.lyraos.driver.policy
%{_datadir}/applications/org.lyraos.LyraDriver.desktop
%{_datadir}/icons/hicolor/scalable/apps/org.lyraos.LyraDriver.svg
%{_sysconfdir}/xdg/autostart/org.lyraos.LyraDriver-check.desktop
%dir %{_sharedstatedir}/lyra-driver
%ghost %{_sharedstatedir}/lyra-driver/pending-test

%changelog
