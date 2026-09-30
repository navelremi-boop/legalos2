use strict;
use warnings;
my $root = "/tmp/mail/capa";
mkdir $root unless -d $root;
mkdir "$root/new" unless -d "$root/new";
mkdir "$root/cur" unless -d "$root/cur";
mkdir "$root/tmp" unless -d "$root/tmp";
my $deja = 0;
opendir my $dh, "$root/new" or die $!;
while (readdir $dh) { $deja++ if $_ !~ /^\.\.?$/ }
closedir $dh;
my $cible = 50000;
if ($deja >= $cible) {
    print "deja $deja\n";
    exit 0;
}
for (my $i = $deja + 1; $i <= $cible; $i++) {
    my $path = "$root/new/$i.legalos";
    open my $fh, ">", $path or die "$path: $!";
    print $fh "From: volume\@example.com\r\n";
    print $fh "To: capa\@localhost\r\n";
    print $fh "Subject: volume $i\r\n";
    print $fh "Message-ID: <vol-$i\@legalos.test>\r\n";
    print $fh "\r\nvolume\r\n";
    close $fh;
}
print "ecrit $cible\n";
