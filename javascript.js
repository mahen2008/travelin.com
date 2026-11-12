//menu
var tombolMenu =$(".tombol-menu");
var menu = $("nav .menu ul");

function klikMenu (){
    tombolMenu.click(function(){
        menu.toggle();
    });
    menu.click(function(){
        menu.toggle();
    });
}

$(document).ready(function(){
    var width = $(window).width();
    if(width < 990){
        klikMenu();
    }
})

//check lebar
$(window).resize(function(){
    var width = $(window).width();
    if (width> 989){
        menu.css("display","block");
        //display:block
    } else {
        menu.css("display","none");
    }
    klikMenu();
});

//efek croll
$(document).ready(function(){
    var scroll_pos = 0;
    $(document). scroll (function(){
        scroll_pos=$(this).scrollTop();
        if(scroll_pos > 0){
            $("nav").addClass("putih");
            $("nav img.hitam").show();
            $("nav img.putih").hide();
        } else {
            $("nav").removeClass("putih");
            $("nav img.hitam").hide();
            $("nav img.putih").show();
        }
    })
});

// Link "Help" di footer membuka kotak chat
// (jika chat tidak ada, link tetap menuju bagian Support)
document.getElementById("buka-chat").addEventListener("click", function (e) {
    var tombol = document.querySelector(".cw-toggle");
    var panel = document.querySelector(".cw-panel");
    if (tombol && panel) {
        e.preventDefault();
        if (panel.hidden) tombol.click();
    }
});
