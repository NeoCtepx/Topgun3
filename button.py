import time
start_time= time.time()
def fun():
    a=2
    b=3
    c=a+b
end_time= time.time()
fun()
timetaken = end_time - start_time
print("Your program takes: ", timetaken) # 0.0345
a=3
b=4
a, b = b, a
print(a, b) # a= 4, b =3
